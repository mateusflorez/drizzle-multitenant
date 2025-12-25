import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchExecutor, createBatchExecutor } from './batch-executor.js';
import { MigrationExecutor } from './migration-executor.js';
import type { BatchExecutorConfig } from './types.js';
import type { MigrationFile, TenantMigrationResult, TenantMigrationStatus } from '../types.js';

describe('BatchExecutor', () => {
  let batchExecutor: BatchExecutor;
  let mockConfig: BatchExecutorConfig;
  let mockExecutor: MigrationExecutor;
  let mockLoadMigrations: () => Promise<MigrationFile[]>;
  let mockMigrations: MigrationFile[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockMigrations = [
      { name: '0001_init', path: '/migrations/0001_init.sql', sql: 'CREATE TABLE test', timestamp: 1, hash: 'hash1' },
      { name: '0002_add_users', path: '/migrations/0002_add_users.sql', sql: 'CREATE TABLE users', timestamp: 2, hash: 'hash2' },
    ];

    mockConfig = {
      tenantDiscovery: vi.fn().mockResolvedValue(['tenant-1', 'tenant-2', 'tenant-3']),
    };

    mockExecutor = {
      migrateTenant: vi.fn().mockImplementation(async (tenantId: string) => ({
        tenantId,
        schemaName: `tenant_${tenantId}`,
        success: true,
        appliedMigrations: ['0001_init', '0002_add_users'],
        durationMs: 100,
        format: 'name',
      })),
      markAsApplied: vi.fn().mockImplementation(async (tenantId: string) => ({
        tenantId,
        schemaName: `tenant_${tenantId}`,
        success: true,
        appliedMigrations: ['0001_init', '0002_add_users'],
        durationMs: 50,
        format: 'name',
      })),
      getTenantStatus: vi.fn().mockImplementation(async (tenantId: string) => ({
        tenantId,
        schemaName: `tenant_${tenantId}`,
        appliedCount: 2,
        pendingCount: 0,
        pendingMigrations: [],
        status: 'ok',
        format: 'name',
      })),
    } as unknown as MigrationExecutor;

    mockLoadMigrations = vi.fn().mockResolvedValue(mockMigrations);

    batchExecutor = new BatchExecutor(mockConfig, mockExecutor, mockLoadMigrations);
  });

  describe('createBatchExecutor factory', () => {
    it('should create a BatchExecutor instance', () => {
      const instance = createBatchExecutor(mockConfig, mockExecutor, mockLoadMigrations);
      expect(instance).toBeInstanceOf(BatchExecutor);
    });
  });

  describe('migrateAll', () => {
    it('should migrate all tenants successfully', async () => {
      const results = await batchExecutor.migrateAll();

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(3);
      expect(results.failed).toBe(0);
      expect(results.skipped).toBe(0);
      expect(results.details).toHaveLength(3);
    });

    it('should respect concurrency limit', async () => {
      let concurrentCalls = 0;
      let maxConcurrentCalls = 0;

      vi.mocked(mockExecutor.migrateTenant).mockImplementation(async (tenantId: string) => {
        concurrentCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCalls--;
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          appliedMigrations: [],
          durationMs: 10,
        };
      });

      await batchExecutor.migrateAll({ concurrency: 2 });

      expect(maxConcurrentCalls).toBeLessThanOrEqual(2);
    });

    it('should call onProgress callbacks', async () => {
      const onProgress = vi.fn();

      await batchExecutor.migrateAll({ concurrency: 1, onProgress });

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'completed');
      expect(onProgress).toHaveBeenCalledWith('tenant-2', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-2', 'completed');
      expect(onProgress).toHaveBeenCalledWith('tenant-3', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-3', 'completed');
    });

    it('should handle failed migrations', async () => {
      vi.mocked(mockExecutor.migrateTenant).mockImplementation(async (tenantId: string) => {
        if (tenantId === 'tenant-2') {
          return {
            tenantId,
            schemaName: `tenant_${tenantId}`,
            success: false,
            appliedMigrations: [],
            error: 'Migration failed',
            durationMs: 50,
          };
        }
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          appliedMigrations: ['0001_init'],
          durationMs: 100,
        };
      });

      const results = await batchExecutor.migrateAll({ concurrency: 1 });

      expect(results.succeeded).toBe(2);
      expect(results.failed).toBe(1);
    });

    it('should pass dryRun option to executor', async () => {
      await batchExecutor.migrateAll({ dryRun: true });

      expect(mockExecutor.migrateTenant).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ dryRun: true })
      );
    });

    it('should abort when onError returns abort', async () => {
      vi.mocked(mockExecutor.migrateTenant).mockRejectedValue(new Error('Executor failed'));
      const onError = vi.fn().mockReturnValue('abort');

      const results = await batchExecutor.migrateAll({ concurrency: 1, onError });

      expect(onError).toHaveBeenCalled();
      expect(results.failed).toBe(1);
      expect(results.skipped).toBe(2);
    });

    it('should continue when onError returns continue', async () => {
      vi.mocked(mockExecutor.migrateTenant).mockImplementation(async (tenantId: string) => {
        if (tenantId === 'tenant-1') {
          throw new Error('First failed');
        }
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          appliedMigrations: [],
          durationMs: 100,
        };
      });
      const onError = vi.fn().mockReturnValue('continue');

      const results = await batchExecutor.migrateAll({ concurrency: 1, onError });

      expect(onError).toHaveBeenCalled();
      expect(results.failed).toBe(1);
      expect(results.succeeded).toBe(2);
      expect(results.skipped).toBe(0);
    });

    it('should call onProgress with failed status on error', async () => {
      vi.mocked(mockExecutor.migrateTenant).mockRejectedValue(new Error('Executor failed'));
      const onProgress = vi.fn();
      const onError = vi.fn().mockReturnValue('continue');

      await batchExecutor.migrateAll({ concurrency: 1, onProgress, onError });

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'failed');
    });

    it('should load migrations once', async () => {
      await batchExecutor.migrateAll();

      expect(mockLoadMigrations).toHaveBeenCalledTimes(1);
    });
  });

  describe('migrateTenants', () => {
    it('should migrate specific tenants', async () => {
      const results = await batchExecutor.migrateTenants(['tenant-1', 'tenant-3']);

      expect(results.total).toBe(2);
      expect(results.succeeded).toBe(2);
      expect(mockExecutor.migrateTenant).toHaveBeenCalledTimes(2);
    });

    it('should respect concurrency limit', async () => {
      let concurrentCalls = 0;
      let maxConcurrentCalls = 0;

      vi.mocked(mockExecutor.migrateTenant).mockImplementation(async (tenantId: string) => {
        concurrentCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCalls--;
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          appliedMigrations: [],
          durationMs: 10,
        };
      });

      await batchExecutor.migrateTenants(['t1', 't2', 't3', 't4', 't5'], { concurrency: 2 });

      expect(maxConcurrentCalls).toBeLessThanOrEqual(2);
    });

    it('should call onProgress callbacks', async () => {
      const onProgress = vi.fn();

      await batchExecutor.migrateTenants(['tenant-1', 'tenant-2'], { concurrency: 1, onProgress });

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'completed');
    });

    it('should handle errors without aborting', async () => {
      vi.mocked(mockExecutor.migrateTenant).mockImplementation(async (tenantId: string) => {
        if (tenantId === 'tenant-1') {
          throw new Error('First failed');
        }
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          appliedMigrations: [],
          durationMs: 100,
        };
      });
      const onError = vi.fn();

      const results = await batchExecutor.migrateTenants(['tenant-1', 'tenant-2'], { onError });

      expect(results.failed).toBe(1);
      expect(results.succeeded).toBe(1);
      expect(onError).toHaveBeenCalled();
    });

    it('should pass dryRun option', async () => {
      await batchExecutor.migrateTenants(['tenant-1'], { dryRun: true });

      expect(mockExecutor.migrateTenant).toHaveBeenCalledWith(
        'tenant-1',
        expect.any(Array),
        expect.objectContaining({ dryRun: true })
      );
    });
  });

  describe('markAllAsApplied', () => {
    it('should mark all tenants as applied', async () => {
      const results = await batchExecutor.markAllAsApplied();

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(3);
      expect(mockExecutor.markAsApplied).toHaveBeenCalledTimes(3);
    });

    it('should respect concurrency limit', async () => {
      let concurrentCalls = 0;
      let maxConcurrentCalls = 0;

      vi.mocked(mockExecutor.markAsApplied).mockImplementation(async (tenantId: string) => {
        concurrentCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentCalls--;
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          appliedMigrations: [],
          durationMs: 10,
        };
      });

      await batchExecutor.markAllAsApplied({ concurrency: 2 });

      expect(maxConcurrentCalls).toBeLessThanOrEqual(2);
    });

    it('should call onProgress callbacks', async () => {
      const onProgress = vi.fn();

      await batchExecutor.markAllAsApplied({ concurrency: 1, onProgress });

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'completed');
    });

    it('should abort when onError returns abort', async () => {
      vi.mocked(mockExecutor.markAsApplied).mockRejectedValue(new Error('Mark failed'));
      const onError = vi.fn().mockReturnValue('abort');

      const results = await batchExecutor.markAllAsApplied({ concurrency: 1, onError });

      expect(results.failed).toBe(1);
      expect(results.skipped).toBe(2);
    });

    it('should continue when onError returns continue', async () => {
      vi.mocked(mockExecutor.markAsApplied).mockImplementation(async (tenantId: string) => {
        if (tenantId === 'tenant-1') {
          throw new Error('First failed');
        }
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          appliedMigrations: [],
          durationMs: 50,
        };
      });
      const onError = vi.fn().mockReturnValue('continue');

      const results = await batchExecutor.markAllAsApplied({ concurrency: 1, onError });

      expect(results.failed).toBe(1);
      expect(results.succeeded).toBe(2);
    });
  });

  describe('getStatus', () => {
    it('should get status for all tenants', async () => {
      const statuses = await batchExecutor.getStatus();

      expect(statuses).toHaveLength(3);
      expect(mockExecutor.getTenantStatus).toHaveBeenCalledTimes(3);
    });

    it('should pass migrations to getTenantStatus', async () => {
      await batchExecutor.getStatus();

      expect(mockExecutor.getTenantStatus).toHaveBeenCalledWith('tenant-1', mockMigrations);
      expect(mockExecutor.getTenantStatus).toHaveBeenCalledWith('tenant-2', mockMigrations);
      expect(mockExecutor.getTenantStatus).toHaveBeenCalledWith('tenant-3', mockMigrations);
    });

    it('should return correct status for each tenant', async () => {
      vi.mocked(mockExecutor.getTenantStatus).mockImplementation(async (tenantId: string) => {
        if (tenantId === 'tenant-2') {
          return {
            tenantId,
            schemaName: `tenant_${tenantId}`,
            appliedCount: 1,
            pendingCount: 1,
            pendingMigrations: ['0002_add_users'],
            status: 'behind',
            format: 'name',
          };
        }
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          appliedCount: 2,
          pendingCount: 0,
          pendingMigrations: [],
          status: 'ok',
          format: 'name',
        };
      });

      const statuses = await batchExecutor.getStatus();

      const tenant2 = statuses.find(s => s.tenantId === 'tenant-2');
      expect(tenant2?.status).toBe('behind');
      expect(tenant2?.pendingCount).toBe(1);
    });
  });

  describe('result aggregation', () => {
    it('should correctly count succeeded and failed', async () => {
      vi.mocked(mockExecutor.migrateTenant).mockImplementation(async (tenantId: string) => {
        if (tenantId === 'tenant-2') {
          return {
            tenantId,
            schemaName: `tenant_${tenantId}`,
            success: false,
            appliedMigrations: [],
            error: 'Failed',
            durationMs: 50,
          };
        }
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          appliedMigrations: ['0001_init'],
          durationMs: 100,
        };
      });

      const results = await batchExecutor.migrateAll();

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(2);
      expect(results.failed).toBe(1);
      expect(results.skipped).toBe(0);
    });

    it('should correctly count skipped tenants', async () => {
      vi.mocked(mockExecutor.migrateTenant).mockRejectedValue(new Error('Fatal error'));
      const onError = vi.fn().mockReturnValue('abort');

      const results = await batchExecutor.migrateAll({ concurrency: 1, onError });

      expect(results.failed).toBe(1);
      expect(results.skipped).toBe(2);
    });

    it('should include details for each tenant', async () => {
      const results = await batchExecutor.migrateAll();

      expect(results.details).toHaveLength(3);
      expect(results.details[0].tenantId).toBe('tenant-1');
      expect(results.details[1].tenantId).toBe('tenant-2');
      expect(results.details[2].tenantId).toBe('tenant-3');
    });
  });

  describe('empty tenant list', () => {
    it('should handle empty tenant discovery', async () => {
      vi.mocked(mockConfig.tenantDiscovery).mockResolvedValue([]);

      const results = await batchExecutor.migrateAll();

      expect(results.total).toBe(0);
      expect(results.succeeded).toBe(0);
      expect(results.failed).toBe(0);
    });

    it('should handle empty tenant list for migrateTenants', async () => {
      const results = await batchExecutor.migrateTenants([]);

      expect(results.total).toBe(0);
    });
  });
});
