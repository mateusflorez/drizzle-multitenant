import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationExecutor, createMigrationExecutor } from './migration-executor.js';
import type { MigrationExecutorConfig, MigrationExecutorDependencies } from './types.js';
import type { MigrationFile } from '../types.js';
import type { DetectedFormat } from '../table-format.js';

describe('MigrationExecutor', () => {
  let executor: MigrationExecutor;
  let mockConfig: MigrationExecutorConfig;
  let mockDeps: MigrationExecutorDependencies;
  let mockPool: any;
  let mockClient: any;
  let mockMigrations: MigrationFile[];
  let mockFormat: DetectedFormat;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: vi.fn().mockResolvedValue(mockClient),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    mockMigrations = [
      { name: '0001_init', path: '/migrations/0001_init.sql', sql: 'CREATE TABLE test', timestamp: 1, hash: 'hash1' },
      { name: '0002_add_users', path: '/migrations/0002_add_users.sql', sql: 'CREATE TABLE users', timestamp: 2, hash: 'hash2' },
      { name: '0003_add_posts', path: '/migrations/0003_add_posts.sql', sql: 'CREATE TABLE posts', timestamp: 3, hash: 'hash3' },
    ];

    mockFormat = {
      format: 'name',
      tableName: '__drizzle_migrations',
      columns: {
        identifier: 'name',
        timestamp: 'created_at',
        timestampType: 'timestamp',
      },
    };

    mockConfig = {
      hooks: {
        beforeTenant: vi.fn().mockResolvedValue(undefined),
        afterTenant: vi.fn().mockResolvedValue(undefined),
        beforeMigration: vi.fn().mockResolvedValue(undefined),
        afterMigration: vi.fn().mockResolvedValue(undefined),
      },
    };

    mockDeps = {
      createPool: vi.fn().mockResolvedValue(mockPool),
      schemaNameTemplate: (id) => `tenant_${id}`,
      migrationsTableExists: vi.fn().mockResolvedValue(true),
      ensureMigrationsTable: vi.fn().mockResolvedValue(undefined),
      getOrDetectFormat: vi.fn().mockResolvedValue(mockFormat),
      loadMigrations: vi.fn().mockResolvedValue(mockMigrations),
    };

    executor = new MigrationExecutor(mockConfig, mockDeps);
  });

  describe('createMigrationExecutor factory', () => {
    it('should create a MigrationExecutor instance', () => {
      const instance = createMigrationExecutor(mockConfig, mockDeps);
      expect(instance).toBeInstanceOf(MigrationExecutor);
    });
  });

  describe('migrateTenant', () => {
    it('should apply pending migrations successfully', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await executor.migrateTenant('tenant-1');

      expect(result.tenantId).toBe('tenant-1');
      expect(result.schemaName).toBe('tenant_tenant-1');
      expect(result.success).toBe(true);
      expect(result.appliedMigrations).toEqual(['0001_init', '0002_add_users', '0003_add_posts']);
      expect(result.format).toBe('name');
    });

    it('should skip already applied migrations', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
        ],
      });

      const result = await executor.migrateTenant('tenant-1');

      expect(result.success).toBe(true);
      expect(result.appliedMigrations).toEqual(['0003_add_posts']);
    });

    it('should handle dry run mode', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await executor.migrateTenant('tenant-1', undefined, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.appliedMigrations).toEqual(['0001_init', '0002_add_users', '0003_add_posts']);
      expect(mockPool.connect).not.toHaveBeenCalled(); // No transaction for dry run
    });

    it('should use provided migrations instead of loading', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await executor.migrateTenant('tenant-1', mockMigrations);

      expect(mockDeps.loadMigrations).not.toHaveBeenCalled();
    });

    it('should call lifecycle hooks', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await executor.migrateTenant('tenant-1');

      expect(mockConfig.hooks?.beforeTenant).toHaveBeenCalledWith('tenant-1');
      expect(mockConfig.hooks?.afterTenant).toHaveBeenCalledWith('tenant-1', expect.any(Object));
      expect(mockConfig.hooks?.beforeMigration).toHaveBeenCalledWith('tenant-1', '0001_init');
      expect(mockConfig.hooks?.afterMigration).toHaveBeenCalledWith('tenant-1', '0001_init', expect.any(Number));
    });

    it('should call onProgress callback', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });
      const onProgress = vi.fn();

      await executor.migrateTenant('tenant-1', undefined, { onProgress });

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'migrating', '0001_init');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'migrating', '0002_add_users');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'migrating', '0003_add_posts');
    });

    it('should handle migration failure', async () => {
      mockClient.query.mockImplementation((sql: string) => {
        if (sql.includes('CREATE TABLE users')) {
          throw new Error('Syntax error');
        }
        return { rows: [] };
      });
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await executor.migrateTenant('tenant-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Syntax error');
      expect(result.appliedMigrations).toEqual(['0001_init']); // Only first one applied
    });

    it('should rollback transaction on failure', async () => {
      mockClient.query.mockImplementation((sql: string) => {
        if (sql.includes('CREATE TABLE test')) {
          throw new Error('Migration failed');
        }
        return { rows: [] };
      });
      mockPool.query.mockResolvedValue({ rows: [] });

      await executor.migrateTenant('tenant-1');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should end pool after operation', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await executor.migrateTenant('tenant-1');

      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should include duration in result', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await executor.migrateTenant('tenant-1');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return empty applied when all up to date', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const result = await executor.migrateTenant('tenant-1');

      expect(result.success).toBe(true);
      expect(result.appliedMigrations).toHaveLength(0);
    });
  });

  describe('markAsApplied', () => {
    it('should mark pending migrations without executing SQL', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await executor.markAsApplied('tenant-1');

      expect(result.success).toBe(true);
      expect(result.appliedMigrations).toEqual(['0001_init', '0002_add_users', '0003_add_posts']);
      expect(mockPool.connect).not.toHaveBeenCalled(); // No transaction
    });

    it('should skip already applied migrations', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
        ],
      });

      const result = await executor.markAsApplied('tenant-1');

      expect(result.success).toBe(true);
      expect(result.appliedMigrations).toEqual(['0002_add_users', '0003_add_posts']);
    });

    it('should call lifecycle hooks', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await executor.markAsApplied('tenant-1');

      expect(mockConfig.hooks?.beforeTenant).toHaveBeenCalledWith('tenant-1');
      expect(mockConfig.hooks?.afterTenant).toHaveBeenCalled();
      expect(mockConfig.hooks?.beforeMigration).toHaveBeenCalledWith('tenant-1', '0001_init');
      expect(mockConfig.hooks?.afterMigration).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockPool.query.mockRejectedValue(new Error('Insert failed'));

      const result = await executor.markAsApplied('tenant-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insert failed');
    });

    it('should end pool after operation', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await executor.markAsApplied('tenant-1');

      expect(mockPool.end).toHaveBeenCalled();
    });
  });

  describe('getTenantStatus', () => {
    it('should return ok status when all migrations applied', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const status = await executor.getTenantStatus('tenant-1');

      expect(status.tenantId).toBe('tenant-1');
      expect(status.schemaName).toBe('tenant_tenant-1');
      expect(status.status).toBe('ok');
      expect(status.appliedCount).toBe(3);
      expect(status.pendingCount).toBe(0);
      expect(status.pendingMigrations).toHaveLength(0);
    });

    it('should return behind status with pending migrations', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
        ],
      });

      const status = await executor.getTenantStatus('tenant-1');

      expect(status.status).toBe('behind');
      expect(status.appliedCount).toBe(1);
      expect(status.pendingCount).toBe(2);
      expect(status.pendingMigrations).toEqual(['0002_add_users', '0003_add_posts']);
    });

    it('should handle missing migrations table', async () => {
      vi.mocked(mockDeps.migrationsTableExists).mockResolvedValue(false);

      const status = await executor.getTenantStatus('tenant-1');

      expect(status.status).toBe('behind');
      expect(status.appliedCount).toBe(0);
      expect(status.pendingCount).toBe(3);
      expect(status.format).toBeNull();
    });

    it('should return error status on exception', async () => {
      mockPool.query.mockRejectedValue(new Error('Query failed'));

      const status = await executor.getTenantStatus('tenant-1');

      expect(status.status).toBe('error');
      expect(status.error).toBe('Query failed');
    });

    it('should use provided migrations', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await executor.getTenantStatus('tenant-1', mockMigrations);

      expect(mockDeps.loadMigrations).not.toHaveBeenCalled();
    });

    it('should end pool after operation', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await executor.getTenantStatus('tenant-1');

      expect(mockPool.end).toHaveBeenCalled();
    });
  });

  describe('getAppliedMigrations', () => {
    it('should return applied migrations with parsed dates', async () => {
      const appliedAt = new Date();
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: appliedAt.toISOString() },
        ],
      });

      const applied = await executor.getAppliedMigrations(mockPool, 'tenant_test', mockFormat);

      expect(applied).toHaveLength(1);
      expect(applied[0].identifier).toBe('0001_init');
      expect(applied[0].name).toBe('0001_init');
      expect(applied[0].appliedAt).toBeInstanceOf(Date);
    });

    it('should handle bigint timestamps', async () => {
      const bigintFormat: DetectedFormat = {
        format: 'drizzle-kit',
        tableName: '__drizzle_migrations',
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'bigint',
        },
      };
      const timestamp = Date.now();
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: 'hash1', applied_at: timestamp },
        ],
      });

      const applied = await executor.getAppliedMigrations(mockPool, 'tenant_test', bigintFormat);

      expect(applied[0].hash).toBe('hash1');
      expect(applied[0].appliedAt).toBeInstanceOf(Date);
    });
  });

  describe('getPendingMigrations', () => {
    it('should return only pending migrations', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
        ],
      });

      const pending = await executor.getPendingMigrations(mockPool, 'tenant_test', mockMigrations, mockFormat);

      expect(pending).toHaveLength(2);
      expect(pending.map(m => m.name)).toEqual(['0002_add_users', '0003_add_posts']);
    });

    it('should return all migrations when none applied', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const pending = await executor.getPendingMigrations(mockPool, 'tenant_test', mockMigrations, mockFormat);

      expect(pending).toHaveLength(3);
    });

    it('should return empty array when all applied', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const pending = await executor.getPendingMigrations(mockPool, 'tenant_test', mockMigrations, mockFormat);

      expect(pending).toHaveLength(0);
    });
  });

  describe('executeMigration', () => {
    it('should apply migration with SQL execution', async () => {
      await executor.executeMigration(mockPool, 'tenant_test', mockMigrations[0], mockFormat);

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(mockMigrations[0].sql);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should only record when markOnly is true', async () => {
      await executor.executeMigration(mockPool, 'tenant_test', mockMigrations[0], mockFormat, { markOnly: true });

      expect(mockPool.connect).not.toHaveBeenCalled();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['0001_init'])
      );
    });

    it('should call onProgress with correct status', async () => {
      const onProgress = vi.fn();

      await executor.executeMigration(mockPool, 'tenant_test', mockMigrations[0], mockFormat, { onProgress });

      expect(onProgress).toHaveBeenCalledWith('applying');
    });

    it('should call onProgress with recording status when markOnly', async () => {
      const onProgress = vi.fn();

      await executor.executeMigration(mockPool, 'tenant_test', mockMigrations[0], mockFormat, { markOnly: true, onProgress });

      expect(onProgress).toHaveBeenCalledWith('recording');
    });
  });

  describe('executeMigrations', () => {
    it('should execute multiple migrations in order', async () => {
      const applied = await executor.executeMigrations(mockPool, 'tenant_test', mockMigrations, mockFormat);

      expect(applied).toEqual(['0001_init', '0002_add_users', '0003_add_posts']);
    });
  });

  describe('recordMigration', () => {
    it('should insert migration record', async () => {
      await executor.recordMigration(mockPool, 'tenant_test', mockMigrations[0], mockFormat);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "tenant_test"."__drizzle_migrations"'),
        expect.arrayContaining(['0001_init'])
      );
    });

    it('should use hash for hash-based format', async () => {
      const hashFormat: DetectedFormat = {
        format: 'hash',
        tableName: '__drizzle_migrations',
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'bigint',
        },
      };

      await executor.recordMigration(mockPool, 'tenant_test', mockMigrations[0], hashFormat);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['hash1'])
      );
    });

    it('should use bigint timestamp for drizzle-kit format', async () => {
      const drizzleKitFormat: DetectedFormat = {
        format: 'drizzle-kit',
        tableName: '__drizzle_migrations',
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'bigint',
        },
      };

      await executor.recordMigration(mockPool, 'tenant_test', mockMigrations[0], drizzleKitFormat);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining([expect.any(Number)])
      );
    });
  });

  describe('hash-based format support', () => {
    it('should detect applied migrations by hash', async () => {
      const hashFormat: DetectedFormat = {
        format: 'hash',
        tableName: '__drizzle_migrations',
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'bigint',
        },
      };
      vi.mocked(mockDeps.getOrDetectFormat).mockResolvedValue(hashFormat);
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: 'hash1', applied_at: Date.now() },
        ],
      });

      const result = await executor.migrateTenant('tenant-1');

      expect(result.appliedMigrations).toEqual(['0002_add_users', '0003_add_posts']);
    });

    it('should fall back to name check for backwards compatibility', async () => {
      const hashFormat: DetectedFormat = {
        format: 'hash',
        tableName: '__drizzle_migrations',
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'bigint',
        },
      };
      vi.mocked(mockDeps.getOrDetectFormat).mockResolvedValue(hashFormat);
      // Migration tracked by name instead of hash (backwards compatibility)
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: Date.now() },
        ],
      });

      const result = await executor.migrateTenant('tenant-1');

      // Should recognize 0001_init as applied even though format uses hash
      expect(result.appliedMigrations).toEqual(['0002_add_users', '0003_add_posts']);
    });
  });

  describe('without hooks', () => {
    it('should work without hooks configured', async () => {
      executor = new MigrationExecutor({}, mockDeps);
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await executor.migrateTenant('tenant-1');

      expect(result.success).toBe(true);
    });
  });
});
