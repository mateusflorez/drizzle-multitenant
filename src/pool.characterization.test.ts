/**
 * Characterization Tests for PoolManager
 *
 * These tests document the current behavior of the PoolManager class.
 * They serve as a safety net during refactoring to ensure the public API
 * remains unchanged.
 *
 * @see REFACTOR_PROPOSAL.md for refactoring plan
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PoolManager } from './pool.js';
import type { Config } from './types.js';

// Mock pg
vi.mock('pg', () => {
  const createMockPool = () => ({
    on: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  });
  return {
    Pool: vi.fn(() => createMockPool()),
  };
});

// Mock drizzle-orm
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({ mockDb: true })),
}));

describe('PoolManager Characterization Tests', () => {
  let manager: PoolManager<Record<string, unknown>, Record<string, unknown>>;
  let config: Config<Record<string, unknown>, Record<string, unknown>>;
  let onPoolCreated: ReturnType<typeof vi.fn>;
  let onPoolEvicted: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    onPoolCreated = vi.fn();
    onPoolEvicted = vi.fn();
    onError = vi.fn();

    config = {
      connection: {
        url: 'postgresql://localhost:5432/test',
        poolConfig: {
          max: 5,
        },
      },
      isolation: {
        strategy: 'schema',
        schemaNameTemplate: (id) => `tenant_${id}`,
        maxPools: 3,
        poolTtlMs: 1000,
      },
      schemas: {
        tenant: { users: {} },
        shared: { plans: {} },
      },
      hooks: {
        onPoolCreated,
        onPoolEvicted,
        onError,
      },
    };

    manager = new PoolManager(config);
  });

  afterEach(async () => {
    await manager.dispose();
  });

  describe('Public API Contract', () => {
    it('should expose PoolManager class', () => {
      expect(PoolManager).toBeDefined();
      expect(typeof PoolManager).toBe('function');
    });

    it('should create PoolManager instance with config', () => {
      expect(manager).toBeInstanceOf(PoolManager);
    });

    it('should have all public methods available', () => {
      // Pool access
      expect(typeof manager.getDb).toBe('function');
      expect(typeof manager.getDbAsync).toBe('function');
      expect(typeof manager.getSharedDb).toBe('function');
      expect(typeof manager.getSharedDbAsync).toBe('function');

      // Pool information
      expect(typeof manager.getSchemaName).toBe('function');
      expect(typeof manager.hasPool).toBe('function');
      expect(typeof manager.getPoolCount).toBe('function');
      expect(typeof manager.getActiveTenantIds).toBe('function');

      // Pool management
      expect(typeof manager.evictPool).toBe('function');
      expect(typeof manager.warmup).toBe('function');
      expect(typeof manager.dispose).toBe('function');

      // Cleanup
      expect(typeof manager.startCleanup).toBe('function');
      expect(typeof manager.stopCleanup).toBe('function');

      // Health & Metrics
      expect(typeof manager.healthCheck).toBe('function');
      expect(typeof manager.getMetrics).toBe('function');
    });
  });

  describe('Return Type Contracts', () => {
    it('getDb should return TenantDb', () => {
      const db = manager.getDb('tenant-1');

      expect(db).toBeDefined();
      expect(db).toHaveProperty('mockDb', true);
    });

    it('getDbAsync should return Promise<TenantDb>', async () => {
      const db = await manager.getDbAsync('tenant-1');

      expect(db).toBeDefined();
      expect(db).toHaveProperty('mockDb', true);
    });

    it('getSharedDb should return SharedDb', () => {
      const db = manager.getSharedDb();

      expect(db).toBeDefined();
    });

    it('getSchemaName should return string', () => {
      const schemaName = manager.getSchemaName('tenant-1');

      expect(typeof schemaName).toBe('string');
      expect(schemaName).toBe('tenant_tenant-1');
    });

    it('hasPool should return boolean', () => {
      const result = manager.hasPool('tenant-1');

      expect(typeof result).toBe('boolean');
    });

    it('getPoolCount should return number', () => {
      const count = manager.getPoolCount();

      expect(typeof count).toBe('number');
    });

    it('getActiveTenantIds should return string array', () => {
      manager.getDb('tenant-1');
      const ids = manager.getActiveTenantIds();

      expect(Array.isArray(ids)).toBe(true);
      expect(ids.every((id) => typeof id === 'string')).toBe(true);
    });

    it('healthCheck should return HealthCheckResult', async () => {
      const result = await manager.healthCheck();

      expect(result).toMatchObject({
        healthy: expect.any(Boolean),
        pools: expect.any(Array),
        totalPools: expect.any(Number),
        degradedPools: expect.any(Number),
        unhealthyPools: expect.any(Number),
        timestamp: expect.any(String),
        durationMs: expect.any(Number),
      });
    });

    it('getMetrics should return MetricsResult', () => {
      const metrics = manager.getMetrics();

      expect(metrics).toMatchObject({
        pools: expect.objectContaining({
          total: expect.any(Number),
          maxPools: expect.any(Number),
          tenants: expect.any(Array),
        }),
        shared: expect.objectContaining({
          initialized: expect.any(Boolean),
        }),
        timestamp: expect.any(String),
      });
    });

    it('warmup should return WarmupResult', async () => {
      const result = await manager.warmup(['tenant-1', 'tenant-2']);

      expect(result).toMatchObject({
        total: expect.any(Number),
        succeeded: expect.any(Number),
        failed: expect.any(Number),
        alreadyWarm: expect.any(Number),
        durationMs: expect.any(Number),
        details: expect.any(Array),
      });
    });
  });

  describe('Behavior Contracts', () => {
    it('should return same db instance for same tenant', () => {
      const db1 = manager.getDb('tenant-1');
      const db2 = manager.getDb('tenant-1');

      expect(db1).toBe(db2);
    });

    it('should create pool on first access', () => {
      expect(manager.hasPool('tenant-1')).toBe(false);

      manager.getDb('tenant-1');

      expect(manager.hasPool('tenant-1')).toBe(true);
    });

    it('should increment pool count when creating pools', () => {
      expect(manager.getPoolCount()).toBe(0);

      manager.getDb('tenant-1');
      expect(manager.getPoolCount()).toBe(1);

      manager.getDb('tenant-2');
      expect(manager.getPoolCount()).toBe(2);
    });

    it('should return same shared db instance on multiple calls', () => {
      const db1 = manager.getSharedDb();
      const db2 = manager.getSharedDb();

      expect(db1).toBe(db2);
    });

    it('should use schemaNameTemplate from config', () => {
      const customConfig = {
        ...config,
        isolation: {
          ...config.isolation,
          schemaNameTemplate: (id: string) => `custom_${id}`,
        },
      };

      const customManager = new PoolManager(customConfig);
      expect(customManager.getSchemaName('test')).toBe('custom_test');
    });
  });

  describe('LRU Eviction Contracts', () => {
    it('should evict oldest pool when maxPools is reached', () => {
      // maxPools is 3 in config
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');
      manager.getDb('tenant-3');

      expect(manager.getPoolCount()).toBe(3);
      expect(manager.hasPool('tenant-1')).toBe(true);

      // Adding 4th should evict oldest (tenant-1)
      manager.getDb('tenant-4');

      expect(manager.getPoolCount()).toBe(3);
      expect(manager.hasPool('tenant-1')).toBe(false);
      expect(manager.hasPool('tenant-4')).toBe(true);
    });

    it('should update access time when getting existing pool', () => {
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');
      manager.getDb('tenant-3');

      // Access tenant-1 again to update its access time
      manager.getDb('tenant-1');

      // Adding 4th should now evict tenant-2 (second oldest)
      manager.getDb('tenant-4');

      expect(manager.hasPool('tenant-1')).toBe(true);
      expect(manager.hasPool('tenant-2')).toBe(false);
    });
  });

  describe('Pool Management Contracts', () => {
    it('should remove pool on evictPool', async () => {
      manager.getDb('tenant-1');
      expect(manager.hasPool('tenant-1')).toBe(true);

      await manager.evictPool('tenant-1');

      expect(manager.hasPool('tenant-1')).toBe(false);
    });

    it('should not throw when evicting non-existent pool', async () => {
      await expect(manager.evictPool('non-existent')).resolves.not.toThrow();
    });

    it('should clear all pools on dispose', async () => {
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');

      await manager.dispose();

      expect(manager.getPoolCount()).toBe(0);
    });

    it('should throw when using manager after dispose', async () => {
      await manager.dispose();

      expect(() => manager.getDb('tenant-1')).toThrow('has been disposed');
    });

    it('should be idempotent on dispose', async () => {
      await manager.dispose();
      await expect(manager.dispose()).resolves.not.toThrow();
    });
  });

  describe('Hook Contracts', () => {
    it('should call onPoolCreated when creating new pool', async () => {
      manager.getDb('tenant-1');

      // Wait for async hook
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onPoolCreated).toHaveBeenCalledWith('tenant-1');
    });

    it('should not call onPoolCreated when pool already exists', async () => {
      manager.getDb('tenant-1');
      manager.getDb('tenant-1');

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onPoolCreated).toHaveBeenCalledTimes(1);
    });

    it('should call onPoolEvicted when pool is evicted', async () => {
      // Fill up the cache
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');
      manager.getDb('tenant-3');

      // This should trigger eviction
      manager.getDb('tenant-4');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // onPoolEvicted should have been called for tenant-1
      expect(onPoolEvicted).toHaveBeenCalled();
    });
  });

  describe('Health Check Contracts', () => {
    it('should return healthy when no pools exist', async () => {
      const result = await manager.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.totalPools).toBe(0);
    });

    it('should check all active pools', async () => {
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');

      const result = await manager.healthCheck();

      expect(result.pools).toHaveLength(2);
      expect(result.totalPools).toBe(2);
    });

    it('should filter by tenantIds option', async () => {
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');
      manager.getDb('tenant-3');

      const result = await manager.healthCheck({
        tenantIds: ['tenant-1', 'tenant-3'],
      });

      expect(result.pools).toHaveLength(2);
      expect(result.pools.map((p) => p.tenantId)).not.toContain('tenant-2');
    });

    it('should include pool metrics', async () => {
      manager.getDb('tenant-1');

      const result = await manager.healthCheck();

      expect(result.pools[0]).toMatchObject({
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        status: expect.stringMatching(/^(ok|degraded|unhealthy)$/),
        totalConnections: expect.any(Number),
        idleConnections: expect.any(Number),
        waitingRequests: expect.any(Number),
      });
    });

    it('should include response time when ping is enabled', async () => {
      manager.getDb('tenant-1');

      const result = await manager.healthCheck({ ping: true });

      expect(result.pools[0].responseTimeMs).toBeDefined();
    });

    it('should check shared db when includeShared is true', async () => {
      manager.getSharedDb();

      const result = await manager.healthCheck({ includeShared: true });

      expect(result.sharedDb).toBe('ok');
    });

    it('should include ISO timestamp', async () => {
      const result = await manager.healthCheck();

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Metrics Contracts', () => {
    it('should return empty metrics initially', () => {
      const metrics = manager.getMetrics();

      expect(metrics.pools.total).toBe(0);
      expect(metrics.pools.tenants).toHaveLength(0);
      expect(metrics.shared.initialized).toBe(false);
    });

    it('should include tenant metrics', () => {
      manager.getDb('tenant-1');

      const metrics = manager.getMetrics();
      const tenant = metrics.pools.tenants[0];

      expect(tenant.tenantId).toBe('tenant-1');
      expect(tenant.schemaName).toBe('tenant_tenant-1');
      expect(tenant.connections).toMatchObject({
        total: expect.any(Number),
        idle: expect.any(Number),
        waiting: expect.any(Number),
      });
    });

    it('should include shared db metrics when initialized', () => {
      manager.getSharedDb();

      const metrics = manager.getMetrics();

      expect(metrics.shared.initialized).toBe(true);
      expect(metrics.shared.connections).not.toBeNull();
    });

    it('should return maxPools from config', () => {
      const metrics = manager.getMetrics();

      expect(metrics.pools.maxPools).toBe(3); // from config
    });

    it('should throw after dispose', async () => {
      await manager.dispose();

      expect(() => manager.getMetrics()).toThrow('has been disposed');
    });
  });

  describe('Warmup Contracts', () => {
    it('should warmup specified tenants', async () => {
      const result = await manager.warmup(['tenant-1', 'tenant-2']);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(manager.hasPool('tenant-1')).toBe(true);
      expect(manager.hasPool('tenant-2')).toBe(true);
    });

    it('should include details for each tenant', async () => {
      const result = await manager.warmup(['tenant-1', 'tenant-2']);

      expect(result.details).toHaveLength(2);
      expect(result.details.map((r) => r.tenantId)).toContain('tenant-1');
      expect(result.details.map((r) => r.tenantId)).toContain('tenant-2');
    });

    it('should include duration in details', async () => {
      const result = await manager.warmup(['tenant-1']);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.details[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should support concurrency option', async () => {
      const result = await manager.warmup(
        ['t1', 't2', 't3', 't4', 't5'],
        { concurrency: 2 }
      );

      expect(result.total).toBe(5);
    });
  });

  describe('Cleanup Contracts', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start cleanup interval without error', () => {
      expect(() => manager.startCleanup()).not.toThrow();
    });

    it('should stop cleanup interval without error', () => {
      manager.startCleanup();
      expect(() => manager.stopCleanup()).not.toThrow();
    });

    it('should be idempotent on startCleanup', () => {
      manager.startCleanup();
      expect(() => manager.startCleanup()).not.toThrow();
    });

    it('should be idempotent on stopCleanup', () => {
      expect(() => manager.stopCleanup()).not.toThrow();
    });
  });

  describe('Async Pool Access Contracts', () => {
    it('should validate connection on getDbAsync', async () => {
      const db = await manager.getDbAsync('tenant-1');

      expect(db).toBeDefined();
      expect(manager.hasPool('tenant-1')).toBe(true);
    });

    it('should validate shared db on getSharedDbAsync', async () => {
      const db = await manager.getSharedDbAsync();

      expect(db).toBeDefined();
    });

    it('should reuse pending connection for same tenant', async () => {
      // Start two concurrent requests
      const [db1, db2] = await Promise.all([
        manager.getDbAsync('tenant-1'),
        manager.getDbAsync('tenant-1'),
      ]);

      expect(db1).toBe(db2);
    });
  });
});
