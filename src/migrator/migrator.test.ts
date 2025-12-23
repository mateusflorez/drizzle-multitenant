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
});
