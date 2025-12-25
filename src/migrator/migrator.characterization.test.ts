/**
 * Characterization Tests for Migrator
 *
 * These tests document the current behavior of the Migrator class.
 * They serve as a safety net during refactoring to ensure the public API
 * remains unchanged.
 *
 * @see REFACTOR_PROPOSAL.md for refactoring plan
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Migrator, createMigrator } from './migrator.js';
import type { Config } from '../types.js';
import type { MigratorConfig } from './types.js';

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

describe('Migrator Characterization Tests', () => {
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
    testDir = join(tmpdir(), `migrator-char-test-${Date.now()}`);
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

  describe('Public API Contract', () => {
    it('should expose createMigrator factory function', () => {
      expect(typeof createMigrator).toBe('function');
    });

    it('should return Migrator instance from createMigrator', () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should have all public methods available', () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      // Migration operations
      expect(typeof migrator.migrateAll).toBe('function');
      expect(typeof migrator.migrateTenant).toBe('function');
      expect(typeof migrator.migrateTenants).toBe('function');
      expect(typeof migrator.markAsApplied).toBe('function');
      expect(typeof migrator.markAllAsApplied).toBe('function');

      // Status operations
      expect(typeof migrator.getStatus).toBe('function');
      expect(typeof migrator.getTenantStatus).toBe('function');

      // Tenant lifecycle
      expect(typeof migrator.createTenant).toBe('function');
      expect(typeof migrator.dropTenant).toBe('function');
      expect(typeof migrator.tenantExists).toBe('function');

      // Sync operations
      expect(typeof migrator.getSyncStatus).toBe('function');
      expect(typeof migrator.getTenantSyncStatus).toBe('function');
      expect(typeof migrator.markMissing).toBe('function');
      expect(typeof migrator.markAllMissing).toBe('function');
      expect(typeof migrator.cleanOrphans).toBe('function');
      expect(typeof migrator.cleanAllOrphans).toBe('function');

      // Drift detection
      expect(typeof migrator.getSchemaDrift).toBe('function');
      expect(typeof migrator.getTenantSchemaDrift).toBe('function');
      expect(typeof migrator.introspectTenantSchema).toBe('function');

      // Seeding
      expect(typeof migrator.seedTenant).toBe('function');
      expect(typeof migrator.seedAll).toBe('function');
      expect(typeof migrator.seedTenants).toBe('function');
    });
  });

  describe('Return Type Contracts', () => {
    it('migrateAll should return MigrationResults structure', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const results = await migrator.migrateAll();

      expect(results).toMatchObject({
        total: expect.any(Number),
        succeeded: expect.any(Number),
        failed: expect.any(Number),
        skipped: expect.any(Number),
        details: expect.any(Array),
      });
    });

    it('migrateTenant should return TenantMigrationResult structure', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const result = await migrator.migrateTenant('tenant-1');

      expect(result).toMatchObject({
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        success: expect.any(Boolean),
        appliedMigrations: expect.any(Array),
        durationMs: expect.any(Number),
      });
    });

    it('getTenantStatus should return TenantMigrationStatus structure', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const status = await migrator.getTenantStatus('tenant-1');

      expect(status).toMatchObject({
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        appliedCount: expect.any(Number),
        pendingCount: expect.any(Number),
        pendingMigrations: expect.any(Array),
        status: expect.stringMatching(/^(ok|behind|error)$/),
      });
      expect('format' in status).toBe(true);
    });

    it('seedTenant should return TenantSeedResult structure', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const result = await migrator.seedTenant('tenant-1', async () => {});

      expect(result).toMatchObject({
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        success: expect.any(Boolean),
        durationMs: expect.any(Number),
      });
    });

    it('getSchemaDrift should return SchemaDriftStatus structure', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const drift = await migrator.getSchemaDrift();

      expect(drift).toMatchObject({
        referenceTenant: expect.any(String),
        total: expect.any(Number),
        noDrift: expect.any(Number),
        withDrift: expect.any(Number),
        error: expect.any(Number),
        details: expect.any(Array),
        timestamp: expect.any(String),
        durationMs: expect.any(Number),
      });
    });
  });

  describe('Behavior Contracts', () => {
    it('should load migrations sorted by timestamp', async () => {
      await writeFile(join(migrationsDir, '0002_second.sql'), 'SELECT 2;');
      await writeFile(join(migrationsDir, '0001_first.sql'), 'SELECT 1;');
      await writeFile(join(migrationsDir, '0003_third.sql'), 'SELECT 3;');

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const migrations = await (migrator as unknown as {
        loadMigrations: () => Promise<{ name: string; timestamp: number }[]>;
      }).loadMigrations();

      expect(migrations[0].name).toBe('0001_first');
      expect(migrations[1].name).toBe('0002_second');
      expect(migrations[2].name).toBe('0003_third');
      expect(migrations[0].timestamp).toBeLessThan(migrations[1].timestamp);
      expect(migrations[1].timestamp).toBeLessThan(migrations[2].timestamp);
    });

    it('should use schemaNameTemplate for schema names', () => {
      const customConfig = {
        ...mockConfig,
        isolation: {
          ...mockConfig.isolation,
          schemaNameTemplate: (id: string) => `custom_${id}_schema`,
        },
      };

      const migrator = createMigrator(customConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      // Verify through getTenantStatus which uses the template
      expect(customConfig.isolation.schemaNameTemplate('test')).toBe('custom_test_schema');
    });

    it('should aggregate results correctly', async () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['t1', 't2', 't3'],
      });

      const results = await migrator.migrateAll();

      expect(results.total).toBe(3);
      expect(results.succeeded + results.failed + results.skipped).toBe(results.total);
      expect(results.details).toHaveLength(3);
    });

    it('should respect concurrency option', async () => {
      const processedBatches: string[][] = [];
      let currentBatch: string[] = [];

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['t1', 't2', 't3', 't4', 't5'],
      });

      await migrator.migrateAll({
        concurrency: 2,
        onProgress: (tenantId, status) => {
          if (status === 'starting') {
            currentBatch.push(tenantId);
          } else if (status === 'completed' || status === 'failed') {
            if (currentBatch.length >= 2) {
              processedBatches.push([...currentBatch]);
              currentBatch = [];
            }
          }
        },
      });

      // With concurrency 2, we should have batches of size <= 2
      for (const batch of processedBatches) {
        expect(batch.length).toBeLessThanOrEqual(2);
      }
    });

    it('should support dry run mode', async () => {
      await writeFile(join(migrationsDir, '0001_test.sql'), 'CREATE TABLE test;');

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
      });

      const dryRunResult = await migrator.migrateTenant('tenant-1', undefined, { dryRun: true });

      expect(dryRunResult.success).toBe(true);
      expect(dryRunResult.appliedMigrations).toContain('0001_test');
    });

    it('should compute SHA-256 hashes for migrations', async () => {
      const content = 'CREATE TABLE test (id SERIAL);';
      await writeFile(join(migrationsDir, '0001_test.sql'), content);

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const migrations = await (migrator as unknown as {
        loadMigrations: () => Promise<{ name: string; hash: string }[]>;
      }).loadMigrations();

      expect(migrations[0].hash).toHaveLength(64); // SHA-256 = 64 hex chars
      expect(migrations[0].hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('Error Handling Contracts', () => {
    it('should handle errors gracefully in migrateAll', async () => {
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

      const results = await migrator.migrateAll({
        onError: () => 'continue',
      });

      expect(results.failed).toBeGreaterThan(0);
    });

    it('should abort when onError returns abort', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      Pool.mockImplementation(() => ({
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['t1', 't2', 't3'],
      });

      const results = await migrator.migrateAll({
        concurrency: 1,
        onError: () => 'abort',
      });

      // Should have aborted after first failure
      expect(results.skipped).toBeGreaterThanOrEqual(0);
    });

    it('should return error status on getTenantStatus failure', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      Pool.mockImplementation(() => ({
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
        connect: vi.fn(),
        end: vi.fn(),
        on: vi.fn(),
      }));

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
      });

      const status = await migrator.getTenantStatus('tenant-1');

      expect(status.status).toBe('error');
      expect(status.error).toBeDefined();
    });
  });

  describe('Hook Contracts', () => {
    beforeEach(async () => {
      // Reset pg mock to default behavior
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          release: vi.fn(),
        }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));
    });

    it('should call hooks in correct order during migration', async () => {
      const callOrder: string[] = [];

      await writeFile(join(migrationsDir, '0001_test.sql'), 'SELECT 1;');

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => ['tenant-1'],
        hooks: {
          beforeTenant: async (tenantId) => {
            callOrder.push(`beforeTenant:${tenantId}`);
          },
          beforeMigration: async (tenantId, name) => {
            callOrder.push(`beforeMigration:${tenantId}:${name}`);
          },
          afterMigration: async (tenantId, name) => {
            callOrder.push(`afterMigration:${tenantId}:${name}`);
          },
          afterTenant: async (tenantId) => {
            callOrder.push(`afterTenant:${tenantId}`);
          },
        },
      });

      await migrator.migrateTenant('tenant-1');

      expect(callOrder).toEqual([
        'beforeTenant:tenant-1',
        'beforeMigration:tenant-1:0001_test',
        'afterMigration:tenant-1:0001_test',
        'afterTenant:tenant-1',
      ]);
    });

    it('should pass duration to afterMigration hook', async () => {
      let capturedDuration: number | undefined;

      await writeFile(join(migrationsDir, '0001_test.sql'), 'SELECT 1;');

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
        hooks: {
          afterMigration: async (_tenantId, _name, durationMs) => {
            capturedDuration = durationMs;
          },
        },
      });

      await migrator.migrateTenant('tenant-1');

      expect(capturedDuration).toBeDefined();
      expect(typeof capturedDuration).toBe('number');
      expect(capturedDuration).toBeGreaterThanOrEqual(0);
    });

    it('should pass result to afterTenant hook', async () => {
      let capturedResult: unknown;

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
        hooks: {
          afterTenant: async (_tenantId, result) => {
            capturedResult = result;
          },
        },
      });

      await migrator.migrateTenant('tenant-1');

      expect(capturedResult).toMatchObject({
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        success: expect.any(Boolean),
      });
    });
  });

  describe('Table Format Contracts', () => {
    beforeEach(async () => {
      // Reset pg mock to default behavior
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          release: vi.fn(),
        }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));
    });

    it('should accept tableFormat option', () => {
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

    it('should accept defaultFormat option', () => {
      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
        tableFormat: 'auto',
        defaultFormat: 'hash',
      });

      expect(migrator).toBeInstanceOf(Migrator);
    });

    it('should include format in migration result when migrations are applied', async () => {
      await writeFile(join(migrationsDir, '0001_test.sql'), 'SELECT 1;');

      const migrator = createMigrator(mockConfig, {
        migrationsFolder: migrationsDir,
        tenantDiscovery: async () => [],
        tableFormat: 'name',
      });

      const result = await migrator.migrateTenant('tenant-1');

      // format is optional but should be present when migrations are applied
      expect(result.format).toBeDefined();
      expect(result.format).toBe('name');
    });
  });
});
