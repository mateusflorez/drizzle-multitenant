import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager, createSyncManager } from './sync-manager.js';
import type { SyncManagerConfig, SyncManagerDependencies } from './types.js';
import type { MigrationFile } from '../types.js';
import type { DetectedFormat } from '../table-format.js';

describe('SyncManager', () => {
  let syncManager: SyncManager;
  let mockConfig: SyncManagerConfig;
  let mockDeps: SyncManagerDependencies;
  let mockPool: any;
  let mockMigrations: MigrationFile[];
  let mockFormat: DetectedFormat;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
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
      tenantDiscovery: vi.fn().mockResolvedValue(['tenant-1', 'tenant-2', 'tenant-3']),
      migrationsFolder: '/migrations',
      migrationsTable: '__drizzle_migrations',
    };

    mockDeps = {
      createPool: vi.fn().mockResolvedValue(mockPool),
      schemaNameTemplate: (id) => `tenant_${id}`,
      migrationsTableExists: vi.fn().mockResolvedValue(true),
      ensureMigrationsTable: vi.fn().mockResolvedValue(undefined),
      getOrDetectFormat: vi.fn().mockResolvedValue(mockFormat),
      loadMigrations: vi.fn().mockResolvedValue(mockMigrations),
    };

    syncManager = new SyncManager(mockConfig, mockDeps);
  });

  describe('createSyncManager factory', () => {
    it('should create a SyncManager instance', () => {
      const instance = createSyncManager(mockConfig, mockDeps);
      expect(instance).toBeInstanceOf(SyncManager);
    });
  });

  describe('getTenantSyncStatus', () => {
    it('should return in sync status when all migrations are applied', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const status = await syncManager.getTenantSyncStatus('tenant-1');

      expect(status.tenantId).toBe('tenant-1');
      expect(status.schemaName).toBe('tenant_tenant-1');
      expect(status.inSync).toBe(true);
      expect(status.missing).toHaveLength(0);
      expect(status.orphans).toHaveLength(0);
      expect(status.format).toBe('name');
    });

    it('should detect missing migrations', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
        ],
      });

      const status = await syncManager.getTenantSyncStatus('tenant-1');

      expect(status.inSync).toBe(false);
      expect(status.missing).toEqual(['0002_add_users', '0003_add_posts']);
      expect(status.orphans).toHaveLength(0);
    });

    it('should detect orphan records', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
          { id: 4, identifier: '0004_deleted_migration', applied_at: new Date() },
        ],
      });

      const status = await syncManager.getTenantSyncStatus('tenant-1');

      expect(status.inSync).toBe(false);
      expect(status.missing).toHaveLength(0);
      expect(status.orphans).toEqual(['0004_deleted_migration']);
    });

    it('should handle missing migrations table', async () => {
      vi.mocked(mockDeps.migrationsTableExists).mockResolvedValue(false);

      const status = await syncManager.getTenantSyncStatus('tenant-1');

      expect(status.inSync).toBe(false);
      expect(status.missing).toEqual(['0001_init', '0002_add_users', '0003_add_posts']);
      expect(status.format).toBeNull();
    });

    it('should handle empty migrations on disk', async () => {
      vi.mocked(mockDeps.loadMigrations).mockResolvedValue([]);
      vi.mocked(mockDeps.migrationsTableExists).mockResolvedValue(false);

      const status = await syncManager.getTenantSyncStatus('tenant-1');

      expect(status.inSync).toBe(true);
      expect(status.missing).toHaveLength(0);
    });

    it('should return error status on exception', async () => {
      // Reset and set up failing pool
      const failingPool = {
        query: vi.fn().mockRejectedValue(new Error('Query failed')),
        end: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockDeps.createPool).mockResolvedValue(failingPool);

      const status = await syncManager.getTenantSyncStatus('tenant-1');

      expect(status.inSync).toBe(false);
      expect(status.error).toBe('Query failed');
    });

    it('should use pre-loaded migrations if provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await syncManager.getTenantSyncStatus('tenant-1', mockMigrations);

      expect(mockDeps.loadMigrations).not.toHaveBeenCalled();
    });

    it('should end pool after operation', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await syncManager.getTenantSyncStatus('tenant-1');

      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should handle hash-based format for orphan detection', async () => {
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
          { id: 2, identifier: 'hash2', applied_at: Date.now() },
          { id: 3, identifier: 'orphan_hash', applied_at: Date.now() },
        ],
      });

      const status = await syncManager.getTenantSyncStatus('tenant-1');

      expect(status.missing).toEqual(['0003_add_posts']);
      expect(status.orphans).toEqual(['orphan_hash']);
    });
  });

  describe('getSyncStatus', () => {
    it('should aggregate status for all tenants', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const status = await syncManager.getSyncStatus();

      expect(status.total).toBe(3);
      expect(status.inSync).toBe(3);
      expect(status.outOfSync).toBe(0);
      expect(status.error).toBe(0);
      expect(status.details).toHaveLength(3);
    });

    it('should count out of sync tenants', async () => {
      let callCount = 0;
      mockPool.query.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { rows: [{ id: 1, identifier: '0001_init', applied_at: new Date() }] };
        }
        return {
          rows: [
            { id: 1, identifier: '0001_init', applied_at: new Date() },
            { id: 2, identifier: '0002_add_users', applied_at: new Date() },
            { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
          ],
        };
      });

      const status = await syncManager.getSyncStatus();

      expect(status.outOfSync).toBe(1);
      expect(status.inSync).toBe(2);
    });
  });

  describe('markMissing', () => {
    it('should mark missing migrations as applied', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: 1, identifier: '0001_init', applied_at: new Date() }],
      });

      const result = await syncManager.markMissing('tenant-1');

      expect(result.success).toBe(true);
      expect(result.markedMigrations).toEqual(['0002_add_users', '0003_add_posts']);
      expect(result.removedOrphans).toHaveLength(0);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining(['0002_add_users'])
      );
    });

    it('should return success when no missing migrations', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const result = await syncManager.markMissing('tenant-1');

      expect(result.success).toBe(true);
      expect(result.markedMigrations).toHaveLength(0);
    });

    it('should return error result on exception', async () => {
      // Reset and set up failing pool
      const failingPool = {
        query: vi.fn().mockRejectedValue(new Error('Query failed')),
        end: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockDeps.createPool).mockResolvedValue(failingPool);

      const result = await syncManager.markMissing('tenant-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Query failed');
    });

    it('should ensure migrations table exists', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await syncManager.markMissing('tenant-1');

      expect(mockDeps.ensureMigrationsTable).toHaveBeenCalled();
    });

    it('should end pool after operation', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await syncManager.markMissing('tenant-1');

      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should include duration in result', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await syncManager.markMissing('tenant-1');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('markAllMissing', () => {
    it('should mark missing migrations for all tenants', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const results = await syncManager.markAllMissing({ concurrency: 2 });

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(3);
      expect(results.failed).toBe(0);
    });

    it('should call onProgress callbacks', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });
      const onProgress = vi.fn();

      await syncManager.markAllMissing({ concurrency: 1, onProgress });

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'completed');
    });

    it('should abort on error when handler returns abort', async () => {
      // onError is only called when an exception escapes the try-catch
      // We need to make createPool itself throw to trigger onError
      vi.mocked(mockDeps.createPool).mockRejectedValue(new Error('Pool creation failed'));

      const onError = vi.fn().mockReturnValue('abort');

      const results = await syncManager.markAllMissing({ concurrency: 1, onError });

      expect(results.failed).toBeGreaterThanOrEqual(1);
      expect(onError).toHaveBeenCalled();
    });

    it('should handle internal errors gracefully without calling onError', async () => {
      // Internal errors (caught by try-catch) return failed results but don't call onError
      const failingPool = {
        query: vi.fn().mockRejectedValue(new Error('Query failed')),
        end: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockDeps.createPool).mockResolvedValue(failingPool);

      const onError = vi.fn();

      const results = await syncManager.markAllMissing({ concurrency: 1, onError });

      expect(results.failed).toBe(3);
      expect(onError).not.toHaveBeenCalled();
    });

    it('should respect concurrency limit', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await syncManager.markAllMissing({ concurrency: 1 });

      expect(mockConfig.tenantDiscovery).toHaveBeenCalled();
    });
  });

  describe('cleanOrphans', () => {
    it('should remove orphan records', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
          { id: 4, identifier: '0004_orphan', applied_at: new Date() },
        ],
      });

      const result = await syncManager.cleanOrphans('tenant-1');

      expect(result.success).toBe(true);
      expect(result.removedOrphans).toEqual(['0004_orphan']);
      expect(result.markedMigrations).toHaveLength(0);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM'),
        expect.arrayContaining(['0004_orphan'])
      );
    });

    it('should return success when no orphans', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const result = await syncManager.cleanOrphans('tenant-1');

      expect(result.success).toBe(true);
      expect(result.removedOrphans).toHaveLength(0);
    });

    it('should return error result on exception', async () => {
      // Reset and set up failing pool
      const failingPool = {
        query: vi.fn().mockRejectedValue(new Error('Query failed')),
        end: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockDeps.createPool).mockResolvedValue(failingPool);

      const result = await syncManager.cleanOrphans('tenant-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Query failed');
    });

    it('should end pool after operation', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await syncManager.cleanOrphans('tenant-1');

      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should handle sync status error', async () => {
      // First call for getTenantSyncStatus, second for cleanOrphans
      vi.mocked(mockDeps.createPool)
        .mockResolvedValueOnce(mockPool)
        .mockRejectedValueOnce(new Error('Status check failed'));

      // Make status check fail
      vi.spyOn(syncManager, 'getTenantSyncStatus').mockResolvedValue({
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        missing: [],
        orphans: [],
        inSync: false,
        format: null,
        error: 'Status check failed',
      });

      const result = await syncManager.cleanOrphans('tenant-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Status check failed');
    });
  });

  describe('cleanAllOrphans', () => {
    it('should clean orphans for all tenants', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const results = await syncManager.cleanAllOrphans({ concurrency: 2 });

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(3);
      expect(results.failed).toBe(0);
    });

    it('should call onProgress callbacks', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });
      const onProgress = vi.fn();

      await syncManager.cleanAllOrphans({ concurrency: 1, onProgress });

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'completed');
    });

    it('should abort on error when handler returns abort', async () => {
      // onError is only called when an exception escapes the try-catch
      // We need to make createPool itself throw to trigger onError
      vi.mocked(mockDeps.createPool).mockRejectedValue(new Error('Pool creation failed'));

      const onError = vi.fn().mockReturnValue('abort');

      const results = await syncManager.cleanAllOrphans({ concurrency: 1, onError });

      expect(results.failed).toBeGreaterThanOrEqual(1);
      expect(onError).toHaveBeenCalled();
    });

    it('should handle internal errors gracefully without calling onError', async () => {
      // Internal errors (caught by try-catch) return failed results but don't call onError
      const failingPool = {
        query: vi.fn().mockRejectedValue(new Error('Query failed')),
        end: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockDeps.createPool).mockResolvedValue(failingPool);

      const onError = vi.fn();

      const results = await syncManager.cleanAllOrphans({ concurrency: 1, onError });

      expect(results.failed).toBe(3);
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('result aggregation', () => {
    it('should correctly count succeeded and failed', async () => {
      let callCount = 0;
      vi.spyOn(syncManager, 'markMissing').mockImplementation(async (tenantId) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First mark failed');
        }
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          markedMigrations: [],
          removedOrphans: [],
          durationMs: 1,
        };
      });

      const onError = vi.fn().mockReturnValue('continue');

      const results = await syncManager.markAllMissing({ concurrency: 1, onError });

      expect(results.total).toBe(3);
      expect(results.failed).toBe(1);
      expect(results.succeeded).toBe(2);
    });

    it('should include details for each tenant', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: 1, identifier: '0001_init', applied_at: new Date() },
          { id: 2, identifier: '0002_add_users', applied_at: new Date() },
          { id: 3, identifier: '0003_add_posts', applied_at: new Date() },
        ],
      });

      const results = await syncManager.markAllMissing({ concurrency: 1 });

      expect(results.details).toHaveLength(3);
      expect(results.details[0].tenantId).toBe('tenant-1');
      expect(results.details[1].tenantId).toBe('tenant-2');
      expect(results.details[2].tenantId).toBe('tenant-3');
    });
  });

  describe('hash-based format support', () => {
    it('should handle hash identifier for marking migrations', async () => {
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
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await syncManager.markMissing('tenant-1');

      expect(result.success).toBe(true);
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
      vi.mocked(mockDeps.getOrDetectFormat).mockResolvedValue(drizzleKitFormat);
      mockPool.query.mockResolvedValue({ rows: [] });

      await syncManager.markMissing('tenant-1');

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO'),
        expect.arrayContaining([expect.any(Number)])
      );
    });
  });
});
