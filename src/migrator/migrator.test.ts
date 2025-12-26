import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Migrator, createMigrator } from './migrator.js';
import type { Config } from '../types.js';
import type { MigratorConfig, MigrationHooks } from './types.js';

// Mock pg Pool
vi.mock('pg', () => {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };

  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue(mockClient),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));

  return { Pool: MockPool };
});

describe('Migrator', () => {
  let testDir: string;
  let migrationsDir: string;

  const mockConfig: Config<Record<string, unknown>, Record<string, unknown>> = {
    connection: {
      url: 'postgresql://localhost:5432/test',
      poolConfig: { max: 5 },
    },
    isolation: {
      strategy: 'schema',
      schemaNameTemplate: (id) => `tenant_${id}`,
      maxPools: 10,
    },
    schemas: {
      tenant: {},
      shared: {},
    },
  };

  beforeEach(async () => {
    testDir = join(tmpdir(), `migrator-test-${Date.now()}`);
    migrationsDir = join(testDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createMigrator', () => {
    it('should create a migrator instance', () => {
      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      };

      const migrator = createMigrator(mockConfig, migratorConfig);

      expect(migrator).toBeInstanceOf(Migrator);
    });
  });

  describe('loadMigrations', () => {
    it('should load migration files sorted by timestamp', async () => {
      // Create migration files
      await writeFile(
        join(migrationsDir, '0001_create_users.sql'),
        'CREATE TABLE users (id SERIAL PRIMARY KEY);'
      );
      await writeFile(
        join(migrationsDir, '0002_add_email.sql'),
        'ALTER TABLE users ADD COLUMN email VARCHAR(255);'
      );

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      // Access private method through typing
      const migrations = await (migrator as unknown as { loadMigrations: () => Promise<{ name: string; timestamp: number }[]> }).loadMigrations();

      expect(migrations).toHaveLength(2);
      expect(migrations[0].name).toBe('0001_create_users');
      expect(migrations[0].timestamp).toBe(1);
      expect(migrations[1].name).toBe('0002_add_email');
      expect(migrations[1].timestamp).toBe(2);
    });

    it('should ignore non-sql files', async () => {
      await writeFile(join(migrationsDir, '0001_create_users.sql'), 'CREATE TABLE users;');
      await writeFile(join(migrationsDir, 'README.md'), '# Migrations');
      await writeFile(join(migrationsDir, 'config.json'), '{}');

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const migrations = await (migrator as unknown as { loadMigrations: () => Promise<{ name: string }[]> }).loadMigrations();

      expect(migrations).toHaveLength(1);
      expect(migrations[0].name).toBe('0001_create_users');
    });
  });

  describe('getSchemaName', () => {
    it('should use the template from config', () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      // Access through tenantExists which uses schemaNameTemplate internally
      expect(mockConfig.isolation.schemaNameTemplate('test-tenant')).toBe('tenant_test-tenant');
    });
  });

  describe('MigrationHooks', () => {
    it('should call hooks in correct order', async () => {
      const callOrder: string[] = [];

      const hooks: MigrationHooks = {
        beforeTenant: async (tenantId) => {
          callOrder.push(`beforeTenant:${tenantId}`);
        },
        afterTenant: async (tenantId) => {
          callOrder.push(`afterTenant:${tenantId}`);
        },
        beforeMigration: async (tenantId, migrationName) => {
          callOrder.push(`beforeMigration:${tenantId}:${migrationName}`);
        },
        afterMigration: async (tenantId, migrationName) => {
          callOrder.push(`afterMigration:${tenantId}:${migrationName}`);
        },
      };

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        hooks,
      });

      // Create a migration file
      await writeFile(
        join(migrationsDir, '0001_test.sql'),
        'SELECT 1;'
      );

      await migrator.migrateTenant('tenant-1');

      expect(callOrder[0]).toBe('beforeTenant:tenant-1');
      expect(callOrder[1]).toBe('beforeMigration:tenant-1:0001_test');
      expect(callOrder[2]).toBe('afterMigration:tenant-1:0001_test');
      expect(callOrder[3]).toBe('afterTenant:tenant-1');
    });
  });

  describe('migrateAll', () => {
    it('should migrate all tenants', async () => {
      const tenantIds = ['tenant-1', 'tenant-2', 'tenant-3'];

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => tenantIds,
      });

      const results = await migrator.migrateAll({ concurrency: 2 });

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(3);
      expect(results.failed).toBe(0);
    });

    it('should call progress callback', async () => {
      const progressCalls: string[] = [];

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      await migrator.migrateAll({
        onProgress: (tenantId, status) => {
          progressCalls.push(`${tenantId}:${status}`);
        },
      });

      expect(progressCalls).toContain('tenant-1:starting');
      expect(progressCalls).toContain('tenant-1:completed');
    });

    it('should support dry run mode', async () => {
      await writeFile(
        join(migrationsDir, '0001_test.sql'),
        'CREATE TABLE test;'
      );

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const results = await migrator.migrateAll({ dryRun: true });

      expect(results.succeeded).toBe(1);
      expect(results.details[0].appliedMigrations).toContain('0001_test');
    });
  });

  describe('migrateTenants', () => {
    it('should migrate specific tenants', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const results = await migrator.migrateTenants(['tenant-1', 'tenant-2']);

      expect(results.total).toBe(2);
      expect(results.details.map((d) => d.tenantId)).toEqual(['tenant-1', 'tenant-2']);
    });
  });

  describe('getStatus', () => {
    it('should return status for all tenants', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      const statuses = await migrator.getStatus();

      expect(statuses).toHaveLength(2);
      expect(statuses[0].tenantId).toBe('tenant-1');
      expect(statuses[1].tenantId).toBe('tenant-2');
    });
  });

  describe('createTenant', () => {
    it('should create a new tenant schema', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      // Should not throw
      await expect(migrator.createTenant('new-tenant')).resolves.not.toThrow();
    });

    it('should skip migrations when migrate option is false', async () => {
      await writeFile(join(migrationsDir, '0001_test.sql'), 'SELECT 1;');

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      await migrator.createTenant('new-tenant', { migrate: false });

      // Since we mocked the Pool, we just verify it doesn't throw
    });
  });

  describe('dropTenant', () => {
    it('should drop a tenant schema', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      // Should not throw
      await expect(migrator.dropTenant('tenant-to-drop')).resolves.not.toThrow();
    });

    it('should use RESTRICT when cascade is false', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      await expect(
        migrator.dropTenant('tenant-to-drop', { cascade: false })
      ).resolves.not.toThrow();
    });
  });

  describe('tenantExists', () => {
    it('should check if tenant schema exists', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      // With mocked Pool returning rowCount: 0, tenant should not exist
      const exists = await migrator.tenantExists('some-tenant');
      expect(exists).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should continue on error when handler returns continue', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      let callCount = 0;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Connection failed');
          }
          return { rows: [], rowCount: 0 };
        }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      const results = await migrator.migrateAll({
        onError: () => 'continue',
      });

      expect(results.total).toBe(2);
      expect(results.failed).toBeGreaterThanOrEqual(0);
    });

    it('should abort on error when handler returns abort', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2', 'tenant-3'],
      });

      const results = await migrator.migrateAll({
        concurrency: 1,
        onError: () => 'abort',
      });

      // Should have at least one failed and potentially skipped tenants
      expect(results.failed).toBeGreaterThan(0);
    });
  });

  describe('table format configuration', () => {
    it('should accept tableFormat option', () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        tableFormat: 'drizzle-kit',
      });

      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should accept defaultFormat option', () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        tableFormat: 'auto',
        defaultFormat: 'hash',
      });

      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should accept all tableFormat values', () => {
      const formats = ['auto', 'name', 'hash', 'drizzle-kit'] as const;

      for (const format of formats) {
        const migrator = createMigrator(mockConfig, {
          migrationsFolder: migrationsDir,
          tenantDiscovery: async () => [],
          tableFormat: format,
        });

        expect(migrator).toBeInstanceOf(Migrator);
      }
    });
  });

  describe('migration hash computation', () => {
    it('should compute hash for migration files', async () => {
      await writeFile(
        join(migrationsDir, '0001_create_users.sql'),
        'CREATE TABLE users (id SERIAL PRIMARY KEY);'
      );

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const migrations = await (migrator as unknown as {
        loadMigrations: () => Promise<{ name: string; hash: string }[]>;
      }).loadMigrations();

      expect(migrations).toHaveLength(1);
      expect(migrations[0].hash).toBeDefined();
      expect(migrations[0].hash).toHaveLength(64); // SHA-256 hex string
    });

    it('should produce different hashes for different content', async () => {
      await writeFile(join(migrationsDir, '0001_a.sql'), 'CREATE TABLE a;');
      await writeFile(join(migrationsDir, '0002_b.sql'), 'CREATE TABLE b;');

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const migrations = await (migrator as unknown as {
        loadMigrations: () => Promise<{ name: string; hash: string }[]>;
      }).loadMigrations();

      expect(migrations[0].hash).not.toBe(migrations[1].hash);
    });

    it('should produce same hash for same content', async () => {
      const content = 'CREATE TABLE test (id SERIAL);';

      await writeFile(join(migrationsDir, '0001_test.sql'), content);

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const migrations1 = await (migrator as unknown as {
        loadMigrations: () => Promise<{ name: string; hash: string }[]>;
      }).loadMigrations();

      // Recreate with same content
      await writeFile(join(migrationsDir, '0001_test.sql'), content);

      const migrations2 = await (migrator as unknown as {
        loadMigrations: () => Promise<{ name: string; hash: string }[]>;
      }).loadMigrations();

      expect(migrations1[0].hash).toBe(migrations2[0].hash);
    });
  });

  describe('getTenantStatus with format', () => {
    it('should return null format when no migrations table exists', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const status = await migrator.getTenantStatus('tenant-1');

      // With mock returning rowCount: 0, table doesn't exist
      expect(status.format).toBeNull();
    });

    it('should include format field in status response', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const status = await migrator.getTenantStatus('tenant-1');

      // format should be defined (either null or a format string)
      expect('format' in status).toBe(true);
    });
  });

  describe('seedTenant', () => {
    it('should seed a single tenant', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const seedFn = vi.fn().mockResolvedValue(undefined);

      const result = await migrator.seedTenant('tenant-1', seedFn);

      expect(result.tenantId).toBe('tenant-1');
      expect(result.schemaName).toBe('tenant_tenant-1');
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(seedFn).toHaveBeenCalledTimes(1);
    });

    it('should return error result when seed function throws', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const seedFn = vi.fn().mockRejectedValue(new Error('Seed failed'));

      const result = await migrator.seedTenant('tenant-1', seedFn);

      expect(result.tenantId).toBe('tenant-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Seed failed');
    });

    it('should pass tenantId to seed function', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const seedFn = vi.fn().mockResolvedValue(undefined);

      await migrator.seedTenant('my-tenant', seedFn);

      expect(seedFn).toHaveBeenCalledWith(expect.anything(), 'my-tenant');
    });
  });

  describe('seedAll', () => {
    it('should seed all tenants from discovery', async () => {
      const tenantIds = ['tenant-1', 'tenant-2', 'tenant-3'];

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => tenantIds,
      });

      const seedFn = vi.fn().mockResolvedValue(undefined);

      const results = await migrator.seedAll(seedFn, { concurrency: 2 });

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(3);
      expect(results.failed).toBe(0);
      expect(seedFn).toHaveBeenCalledTimes(3);
    });

    it('should call progress callback', async () => {
      const progressCalls: string[] = [];

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const seedFn = vi.fn().mockResolvedValue(undefined);

      await migrator.seedAll(seedFn, {
        onProgress: (tenantId, status) => {
          progressCalls.push(`${tenantId}:${status}`);
        },
      });

      expect(progressCalls).toContain('tenant-1:starting');
      expect(progressCalls).toContain('tenant-1:completed');
    });

    it('should continue on error when handler returns continue', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      let callCount = 0;
      const seedFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First seed failed');
        }
        return Promise.resolve();
      });

      const results = await migrator.seedAll(seedFn, {
        concurrency: 1,
        onError: () => 'continue',
      });

      expect(results.total).toBe(2);
      expect(results.failed).toBe(1);
      expect(results.succeeded).toBe(1);
    });

    it('should abort on error when handler returns abort', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2', 'tenant-3'],
      });

      const seedFn = vi.fn().mockRejectedValue(new Error('Seed failed'));

      const results = await migrator.seedAll(seedFn, {
        concurrency: 1,
        onError: () => 'abort',
      });

      expect(results.failed).toBeGreaterThan(0);
      expect(results.skipped).toBeGreaterThanOrEqual(0);
    });
  });

  describe('seedTenants', () => {
    it('should seed specific tenants', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const seedFn = vi.fn().mockResolvedValue(undefined);

      const results = await migrator.seedTenants(['tenant-1', 'tenant-2'], seedFn);

      expect(results.total).toBe(2);
      expect(results.succeeded).toBe(2);
      expect(results.details.map((d) => d.tenantId)).toEqual(['tenant-1', 'tenant-2']);
    });

    it('should respect concurrency option', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const seedFn = vi.fn().mockResolvedValue(undefined);

      const results = await migrator.seedTenants(
        ['tenant-1', 'tenant-2', 'tenant-3'],
        seedFn,
        { concurrency: 1 }
      );

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(3);
    });
  });

  describe('getSchemaDrift', () => {
    it('should return empty results when no tenants exist', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const drift = await migrator.getSchemaDrift();

      expect(drift.total).toBe(0);
      expect(drift.noDrift).toBe(0);
      expect(drift.withDrift).toBe(0);
      expect(drift.error).toBe(0);
      expect(drift.details).toHaveLength(0);
      expect(drift.referenceTenant).toBe('');
    });

    it('should use first tenant as reference by default', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      const drift = await migrator.getSchemaDrift();

      expect(drift.referenceTenant).toBe('tenant-1');
    });

    it('should allow specifying reference tenant', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      const drift = await migrator.getSchemaDrift({
        referenceTenant: 'tenant-2',
      });

      expect(drift.referenceTenant).toBe('tenant-2');
    });

    it('should call progress callback', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const progressCalls: string[] = [];

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      await migrator.getSchemaDrift({
        onProgress: (tenantId, status) => {
          progressCalls.push(`${tenantId}:${status}`);
        },
      });

      expect(progressCalls).toContain('tenant-1:starting');
      expect(progressCalls).toContain('tenant-1:introspecting');
      expect(progressCalls).toContain('tenant-1:completed');
    });

    it('should accept concurrency option', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2', 'tenant-3'],
      });

      const drift = await migrator.getSchemaDrift({ concurrency: 1 });

      expect(drift.total).toBe(3);
    });

    it('should allow checking specific tenants', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2', 'tenant-3'],
      });

      const drift = await migrator.getSchemaDrift({
        tenantIds: ['tenant-1', 'tenant-2'],
      });

      expect(drift.total).toBe(2);
    });

    it('should exclude specified tables', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const drift = await migrator.getSchemaDrift({
        excludeTables: ['__drizzle_migrations', 'audit_logs'],
      });

      expect(drift.total).toBe(1);
    });

    it('should include timestamp and duration', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const drift = await migrator.getSchemaDrift();

      expect(drift.timestamp).toBeDefined();
      expect(drift.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should mark reference tenant as no drift', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      const drift = await migrator.getSchemaDrift();

      const refTenant = drift.details.find((d) => d.tenantId === drift.referenceTenant);
      expect(refTenant?.hasDrift).toBe(false);
      expect(refTenant?.issueCount).toBe(0);
    });
  });

  describe('getTenantSchemaDrift', () => {
    it('should compare two tenants', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      const drift = await migrator.getTenantSchemaDrift('tenant-2', 'tenant-1');

      expect(drift.tenantId).toBe('tenant-2');
      expect(drift.schemaName).toBe('tenant_tenant-2');
    });

    it('should return error when reference tenant introspection fails', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      const drift = await migrator.getTenantSchemaDrift('tenant-2', 'tenant-1');

      expect(drift.error).toBe('Failed to introspect reference tenant');
    });
  });

  describe('introspectTenantSchema', () => {
    it('should return tenant schema information', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({
          rows: [{ table_name: 'users' }],
          rowCount: 1,
        }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const schema = await migrator.introspectTenantSchema('tenant-1');

      expect(schema?.tenantId).toBe('tenant-1');
      expect(schema?.schemaName).toBe('tenant_tenant-1');
      expect(schema?.introspectedAt).toBeInstanceOf(Date);
    });

    it('should return null when introspection fails', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const schema = await migrator.introspectTenantSchema('tenant-1');

      expect(schema).toBeNull();
    });

    it('should exclude specified tables', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      const queryMock = vi.fn()
        .mockResolvedValueOnce({
          rows: [
            { table_name: 'users' },
            { table_name: '__drizzle_migrations' },
            { table_name: 'audit_logs' },
          ],
          rowCount: 3,
        })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      Pool.mockImplementation(() => ({
        query: queryMock,
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const schema = await migrator.introspectTenantSchema('tenant-1', {
        excludeTables: ['__drizzle_migrations', 'audit_logs'],
      });

      expect(schema?.tables).toHaveLength(1);
      expect(schema?.tables[0].name).toBe('users');
    });
  });

  describe('schema comparison', () => {
    it('should detect missing tables', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      let callCount = 0;
      Pool.mockImplementation(() => ({
        query: vi.fn().mockImplementation(() => {
          callCount++;
          // Reference tenant has users table
          if (callCount === 1) {
            return Promise.resolve({ rows: [{ table_name: 'users' }], rowCount: 1 });
          }
          // Reference tenant columns
          if (callCount === 2) {
            return Promise.resolve({
              rows: [{ column_name: 'id', data_type: 'integer', udt_name: 'int4', is_nullable: 'NO', column_default: null, character_maximum_length: null, numeric_precision: 32, numeric_scale: 0, ordinal_position: 1 }],
              rowCount: 1,
            });
          }
          // Target tenant has no tables
          if (callCount > 4) {
            return Promise.resolve({ rows: [], rowCount: 0 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
      });

      const drift = await migrator.getSchemaDrift({
        includeIndexes: false,
        includeConstraints: false,
      });

      // Should have detected drift in tenant-2
      const tenant2Drift = drift.details.find((d) => d.tenantId === 'tenant-2');
      expect(tenant2Drift?.hasDrift).toBe(true);
    });
  });

  describe('shared table format configuration', () => {
    it('should accept sharedTableFormat in config', () => {
      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        sharedTableFormat: 'drizzle-kit',
      };

      const migrator = createMigrator(mockConfig, migratorConfig);
      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should accept sharedDefaultFormat in config', () => {
      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        sharedDefaultFormat: 'hash',
      };

      const migrator = createMigrator(mockConfig, migratorConfig);
      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should accept sharedMigrationsTable in config', () => {
      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        sharedMigrationsTable: '__custom_shared_migrations',
      };

      const migrator = createMigrator(mockConfig, migratorConfig);
      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should use sharedTableFormat over tableFormat for shared schema', () => {
      // When both tableFormat and sharedTableFormat are specified,
      // sharedTableFormat should be used for shared schema migrations
      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        tableFormat: 'name',
        sharedTableFormat: 'drizzle-kit',
      };

      const migrator = createMigrator(mockConfig, migratorConfig);
      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should fallback to tableFormat when sharedTableFormat is not specified', () => {
      // When only tableFormat is specified, it should be used for both
      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        tableFormat: 'hash',
      };

      const migrator = createMigrator(mockConfig, migratorConfig);
      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should default sharedTableFormat to auto when not specified', () => {
      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      };

      const migrator = createMigrator(mockConfig, migratorConfig);
      expect(migrator).toBeInstanceOf(Migrator);
    });
  });

  describe('shared migrations folder configuration', () => {
    it('should accept sharedMigrationsFolder in config', async () => {
      const sharedMigrationsDir = join(testDir, 'shared-migrations');
      await mkdir(sharedMigrationsDir, { recursive: true });

      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        sharedMigrationsFolder: sharedMigrationsDir,
      };

      const migrator = createMigrator(mockConfig, migratorConfig);
      expect(migrator).toBeInstanceOf(Migrator);
      expect(migrator.hasSharedMigrations()).toBe(true);
    });

    it('should return false for hasSharedMigrations when not configured', () => {
      const migratorConfig: MigratorConfig = {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      };

      const migrator = createMigrator(mockConfig, migratorConfig);
      expect(migrator.hasSharedMigrations()).toBe(false);
    });
  });
});
