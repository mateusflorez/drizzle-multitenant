import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Seeder, createSeeder } from './seeder.js';
import type { SeederConfig, SeederDependencies } from './types.js';
import type { SeedFunction } from '../types.js';

// Mock drizzle-orm
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockImplementation(() => ({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  })),
}));

describe('Seeder', () => {
  let seeder: Seeder;
  let mockConfig: SeederConfig;
  let mockDeps: SeederDependencies<Record<string, unknown>, Record<string, unknown>>;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    mockConfig = {
      tenantDiscovery: vi.fn().mockResolvedValue(['tenant-1', 'tenant-2', 'tenant-3']),
    };

    mockDeps = {
      createPool: vi.fn().mockResolvedValue(mockPool),
      schemaNameTemplate: (id) => `tenant_${id}`,
      tenantSchema: {},
    };

    seeder = new Seeder(mockConfig, mockDeps);
  });

  describe('createSeeder factory', () => {
    it('should create a Seeder instance', () => {
      const instance = createSeeder(mockConfig, mockDeps);
      expect(instance).toBeInstanceOf(Seeder);
    });
  });

  describe('seedTenant', () => {
    it('should seed a single tenant', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      const result = await seeder.seedTenant('tenant-1', seedFn);

      expect(result.tenantId).toBe('tenant-1');
      expect(result.schemaName).toBe('tenant_tenant-1');
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(seedFn).toHaveBeenCalledTimes(1);
    });

    it('should return error result when seed function throws', async () => {
      const seedFn = vi.fn().mockRejectedValue(new Error('Seed failed'));

      const result = await seeder.seedTenant('tenant-1', seedFn);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Seed failed');
    });

    it('should pass tenantId to seed function', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      await seeder.seedTenant('my-tenant', seedFn);

      expect(seedFn).toHaveBeenCalledWith(expect.anything(), 'my-tenant');
    });

    it('should create pool with correct schema', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      await seeder.seedTenant('tenant-abc', seedFn);

      expect(mockDeps.createPool).toHaveBeenCalledWith('tenant_tenant-abc');
    });

    it('should end pool after seeding', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      await seeder.seedTenant('tenant-1', seedFn);

      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should end pool even when seed function throws', async () => {
      const seedFn = vi.fn().mockRejectedValue(new Error('Seed failed'));

      await seeder.seedTenant('tenant-1', seedFn);

      expect(mockPool.end).toHaveBeenCalled();
    });
  });

  describe('seedAll', () => {
    it('should seed all tenants from discovery', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      const results = await seeder.seedAll(seedFn, { concurrency: 2 });

      expect(results.total).toBe(3);
      expect(results.succeeded).toBe(3);
      expect(results.failed).toBe(0);
      expect(results.skipped).toBe(0);
      expect(seedFn).toHaveBeenCalledTimes(3);
    });

    it('should call onProgress callbacks', async () => {
      const onProgress = vi.fn();
      const seedFn = vi.fn().mockResolvedValue(undefined);

      await seeder.seedAll(seedFn, {
        concurrency: 1,
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'seeding');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'completed');
    });

    it('should handle partial failures', async () => {
      let callCount = 0;
      const seedFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First seed failed');
        }
        return Promise.resolve();
      });

      const results = await seeder.seedAll(seedFn, {
        concurrency: 1,
      });

      expect(results.succeeded).toBe(2);
      expect(results.failed).toBe(1);
    });

    it('should respect concurrency limit', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      await seeder.seedAll(seedFn, { concurrency: 1 });

      // With concurrency 1, calls should be sequential
      expect(seedFn).toHaveBeenCalledTimes(3);
    });

    it('should abort on error when handler returns abort', async () => {
      // Make seedTenant throw an actual error (not just return error result)
      const originalSeedTenant = seeder.seedTenant.bind(seeder);
      vi.spyOn(seeder, 'seedTenant').mockImplementation(async (tenantId) => {
        throw new Error('Seed failed');
      });

      const onError = vi.fn().mockReturnValue('abort');

      const results = await seeder.seedAll(vi.fn(), {
        concurrency: 1,
        onError,
      });

      // First tenant fails, rest are skipped
      expect(results.failed).toBe(1);
      expect(results.skipped).toBe(2);
    });

    it('should continue on error when handler returns continue', async () => {
      let callCount = 0;
      const seedFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First seed failed');
        }
        return Promise.resolve();
      });
      const onError = vi.fn().mockReturnValue('continue');

      const results = await seeder.seedAll(seedFn, {
        concurrency: 1,
        onError,
      });

      expect(results.succeeded).toBe(2);
      expect(results.failed).toBe(1);
    });
  });

  describe('seedTenants', () => {
    it('should seed specific tenants', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      const results = await seeder.seedTenants(['tenant-1', 'tenant-2'], seedFn);

      expect(results.total).toBe(2);
      expect(results.succeeded).toBe(2);
      expect(seedFn).toHaveBeenCalledTimes(2);
    });

    it('should call onProgress callbacks', async () => {
      const onProgress = vi.fn();
      const seedFn = vi.fn().mockResolvedValue(undefined);

      await seeder.seedTenants(
        ['tenant-1'],
        seedFn,
        { onProgress }
      );

      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'starting');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'seeding');
      expect(onProgress).toHaveBeenCalledWith('tenant-1', 'completed');
    });

    it('should handle empty tenant list', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      const results = await seeder.seedTenants([], seedFn);

      expect(results.total).toBe(0);
      expect(results.succeeded).toBe(0);
      expect(seedFn).not.toHaveBeenCalled();
    });

    it('should respect concurrency limit', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);
      const tenantIds = ['t1', 't2', 't3', 't4'];

      await seeder.seedTenants(tenantIds, seedFn, { concurrency: 2 });

      expect(seedFn).toHaveBeenCalledTimes(4);
    });

    it('should handle partial failures', async () => {
      let callCount = 0;
      const seedFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Second seed failed');
        }
        return Promise.resolve();
      });

      const results = await seeder.seedTenants(
        ['t1', 't2', 't3'],
        seedFn,
        { concurrency: 1 }
      );

      expect(results.succeeded).toBe(2);
      expect(results.failed).toBe(1);
    });

    it('should call onError for failed tenants', async () => {
      // Make seedTenant throw an actual error (not just return error result)
      vi.spyOn(seeder, 'seedTenant').mockImplementation(async () => {
        throw new Error('Seed failed');
      });

      const onError = vi.fn();

      await seeder.seedTenants(
        ['tenant-1'],
        vi.fn(),
        { onError }
      );

      expect(onError).toHaveBeenCalledWith('tenant-1', expect.any(Error));
    });
  });

  describe('result aggregation', () => {
    it('should correctly count succeeded, failed, and skipped', async () => {
      // Mock seedTenant to throw on first call
      let callCount = 0;
      vi.spyOn(seeder, 'seedTenant').mockImplementation(async (tenantId) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First seed failed');
        }
        return {
          tenantId,
          schemaName: `tenant_${tenantId}`,
          success: true,
          durationMs: 1,
        };
      });

      const onError = vi.fn().mockReturnValue('abort');

      const results = await seeder.seedAll(vi.fn(), {
        concurrency: 1,
        onError,
      });

      expect(results.total).toBe(3);
      expect(results.failed).toBe(1);
      expect(results.skipped).toBe(2);
      expect(results.succeeded).toBe(0);
    });

    it('should include details for each tenant', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      const results = await seeder.seedTenants(['t1', 't2'], seedFn);

      expect(results.details).toHaveLength(2);
      expect(results.details[0].tenantId).toBe('t1');
      expect(results.details[1].tenantId).toBe('t2');
    });
  });
});
