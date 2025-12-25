import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthChecker, type HealthCheckerDeps } from './health-checker.js';
import type { PoolEntry } from '../../types.js';

// Mock pool entry factory
function createMockEntry(
  schemaName: string,
  poolMetrics: { totalCount?: number; idleCount?: number; waitingCount?: number } = {}
): PoolEntry<Record<string, unknown>> {
  return {
    db: { mockDb: true } as any,
    pool: {
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      totalCount: poolMetrics.totalCount ?? 5,
      idleCount: poolMetrics.idleCount ?? 3,
      waitingCount: poolMetrics.waitingCount ?? 0,
    } as any,
    lastAccess: Date.now(),
    schemaName,
  };
}

// Create mock shared pool
function createMockSharedPool(
  metrics: { totalCount?: number; idleCount?: number; waitingCount?: number } = {},
  queryResult: 'success' | 'error' | 'timeout' = 'success'
) {
  const queryFn = vi.fn();

  if (queryResult === 'success') {
    queryFn.mockResolvedValue({ rows: [] });
  } else if (queryResult === 'error') {
    queryFn.mockRejectedValue(new Error('Connection failed'));
  } else if (queryResult === 'timeout') {
    queryFn.mockImplementation(() => new Promise(() => {})); // Never resolves
  }

  return {
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    query: queryFn,
    totalCount: metrics.totalCount ?? 5,
    idleCount: metrics.idleCount ?? 3,
    waitingCount: metrics.waitingCount ?? 0,
  } as any;
}

describe('HealthChecker', () => {
  let healthChecker: HealthChecker<Record<string, unknown>>;
  let mockDeps: HealthCheckerDeps<Record<string, unknown>>;
  let entries: Map<string, PoolEntry<Record<string, unknown>>>;
  let tenantIdBySchema: Map<string, string>;
  let sharedPool: ReturnType<typeof createMockSharedPool> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    entries = new Map();
    tenantIdBySchema = new Map();
    sharedPool = null;

    mockDeps = {
      getPoolEntries: () => entries.entries(),
      getTenantIdBySchema: (schemaName) => tenantIdBySchema.get(schemaName),
      getPoolEntry: (schemaName) => entries.get(schemaName),
      getSchemaName: (tenantId) => `tenant_${tenantId}`,
      getSharedPool: () => sharedPool,
    };

    healthChecker = new HealthChecker(mockDeps);
  });

  describe('checkHealth', () => {
    it('should return healthy when no pools exist', async () => {
      const result = await healthChecker.checkHealth();

      expect(result.healthy).toBe(true);
      expect(result.pools).toEqual([]);
      expect(result.sharedDb).toBe('ok');
      expect(result.totalPools).toBe(0);
      expect(result.degradedPools).toBe(0);
      expect(result.unhealthyPools).toBe(0);
      expect(result.timestamp).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should check all pools when no tenantIds specified', async () => {
      const entry1 = createMockEntry('tenant_abc');
      const entry2 = createMockEntry('tenant_xyz');
      entries.set('tenant_abc', entry1);
      entries.set('tenant_xyz', entry2);
      tenantIdBySchema.set('tenant_abc', 'abc');
      tenantIdBySchema.set('tenant_xyz', 'xyz');

      const result = await healthChecker.checkHealth({ ping: true });

      expect(result.healthy).toBe(true);
      expect(result.pools).toHaveLength(2);
      expect(result.totalPools).toBe(2);
    });

    it('should check only specified tenants', async () => {
      const entry1 = createMockEntry('tenant_abc');
      const entry2 = createMockEntry('tenant_xyz');
      entries.set('tenant_abc', entry1);
      entries.set('tenant_xyz', entry2);
      tenantIdBySchema.set('tenant_abc', 'abc');
      tenantIdBySchema.set('tenant_xyz', 'xyz');

      const result = await healthChecker.checkHealth({
        tenantIds: ['abc'],
        ping: true,
      });

      expect(result.pools).toHaveLength(1);
      expect(result.pools[0].tenantId).toBe('abc');
    });

    it('should skip non-existent tenants when specific tenantIds are provided', async () => {
      const entry1 = createMockEntry('tenant_abc');
      entries.set('tenant_abc', entry1);
      tenantIdBySchema.set('tenant_abc', 'abc');

      const result = await healthChecker.checkHealth({
        tenantIds: ['abc', 'nonexistent'],
        ping: true,
      });

      expect(result.pools).toHaveLength(1);
      expect(result.pools[0].tenantId).toBe('abc');
    });

    it('should include shared database health when includeShared is true', async () => {
      sharedPool = createMockSharedPool();

      const result = await healthChecker.checkHealth({ includeShared: true, ping: true });

      expect(result.sharedDb).toBe('ok');
      expect(result.sharedDbResponseTimeMs).toBeDefined();
    });

    it('should skip shared database health when includeShared is false', async () => {
      sharedPool = createMockSharedPool();

      const result = await healthChecker.checkHealth({ includeShared: false });

      expect(result.sharedDb).toBe('ok');
      expect(result.sharedDbResponseTimeMs).toBeUndefined();
    });

    it('should skip shared database when pool is null', async () => {
      sharedPool = null;

      const result = await healthChecker.checkHealth({ includeShared: true, ping: true });

      expect(result.sharedDb).toBe('ok');
      expect(result.sharedDbResponseTimeMs).toBeUndefined();
    });

    it('should detect unhealthy status when ping fails', async () => {
      const entry = createMockEntry('tenant_abc');
      (entry.pool.query as any).mockRejectedValue(new Error('Connection refused'));
      entries.set('tenant_abc', entry);
      tenantIdBySchema.set('tenant_abc', 'abc');

      const result = await healthChecker.checkHealth({ ping: true });

      expect(result.healthy).toBe(false);
      expect(result.unhealthyPools).toBe(1);
      expect(result.pools[0].status).toBe('unhealthy');
      expect(result.pools[0].error).toBe('Connection refused');
    });

    it('should detect degraded status when waiting requests exist', async () => {
      const entry = createMockEntry('tenant_abc', { waitingCount: 5 });
      entries.set('tenant_abc', entry);
      tenantIdBySchema.set('tenant_abc', 'abc');

      const result = await healthChecker.checkHealth({ ping: false });

      expect(result.healthy).toBe(true); // still healthy, just degraded
      expect(result.degradedPools).toBe(1);
      expect(result.pools[0].status).toBe('degraded');
    });

    it('should skip ping when ping option is false', async () => {
      const entry = createMockEntry('tenant_abc');
      entries.set('tenant_abc', entry);
      tenantIdBySchema.set('tenant_abc', 'abc');

      const result = await healthChecker.checkHealth({ ping: false });

      expect(entry.pool.query).not.toHaveBeenCalled();
      expect(result.pools[0].responseTimeMs).toBeUndefined();
    });

    it('should report shared db as unhealthy when ping fails', async () => {
      sharedPool = createMockSharedPool({}, 'error');

      const result = await healthChecker.checkHealth({ includeShared: true, ping: true });

      expect(result.healthy).toBe(false);
      expect(result.sharedDb).toBe('unhealthy');
      expect(result.sharedDbError).toBe('Connection failed');
    });

    it('should report shared db as degraded when waiting requests exist', async () => {
      sharedPool = createMockSharedPool({ waitingCount: 3 });

      const result = await healthChecker.checkHealth({ includeShared: true, ping: true });

      expect(result.healthy).toBe(true);
      expect(result.sharedDb).toBe('degraded');
    });
  });

  describe('checkPoolHealth', () => {
    it('should return ok status for healthy pool', async () => {
      const entry = createMockEntry('tenant_abc');

      const result = await healthChecker.checkPoolHealth(
        'abc',
        'tenant_abc',
        entry,
        true,
        5000
      );

      expect(result.status).toBe('ok');
      expect(result.tenantId).toBe('abc');
      expect(result.schemaName).toBe('tenant_abc');
      expect(result.totalConnections).toBe(5);
      expect(result.idleConnections).toBe(3);
      expect(result.waitingRequests).toBe(0);
      expect(result.responseTimeMs).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should return degraded status when waiting requests exist', async () => {
      const entry = createMockEntry('tenant_abc', { waitingCount: 2 });

      const result = await healthChecker.checkPoolHealth(
        'abc',
        'tenant_abc',
        entry,
        false,
        5000
      );

      expect(result.status).toBe('degraded');
      expect(result.waitingRequests).toBe(2);
    });

    it('should return unhealthy status when ping fails', async () => {
      const entry = createMockEntry('tenant_abc');
      (entry.pool.query as any).mockRejectedValue(new Error('Connection lost'));

      const result = await healthChecker.checkPoolHealth(
        'abc',
        'tenant_abc',
        entry,
        true,
        5000
      );

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Connection lost');
    });

    it('should return degraded when response is slow', async () => {
      const entry = createMockEntry('tenant_abc');
      (entry.pool.query as any).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ rows: [] }), 80);
          })
      );

      // Ping timeout of 150ms means > 75ms response is considered slow
      const result = await healthChecker.checkPoolHealth(
        'abc',
        'tenant_abc',
        entry,
        true,
        150 // timeout where 80ms response is > 50% (75ms)
      );

      // Response > 75ms (half of 150ms timeout) should be degraded
      expect(result.status).toBe('degraded');
    });

    it('should not execute ping when disabled', async () => {
      const entry = createMockEntry('tenant_abc');

      const result = await healthChecker.checkPoolHealth(
        'abc',
        'tenant_abc',
        entry,
        false, // ping disabled
        5000
      );

      expect(entry.pool.query).not.toHaveBeenCalled();
      expect(result.responseTimeMs).toBeUndefined();
    });
  });

  describe('checkSharedDbHealth', () => {
    it('should return ok status for healthy shared db', async () => {
      const pool = createMockSharedPool();

      const result = await healthChecker.checkSharedDbHealth(pool, true, 5000);

      expect(result.status).toBe('ok');
      expect(result.responseTimeMs).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should return degraded status when waiting requests exist', async () => {
      const pool = createMockSharedPool({ waitingCount: 3 });

      const result = await healthChecker.checkSharedDbHealth(pool, true, 5000);

      expect(result.status).toBe('degraded');
    });

    it('should return unhealthy status when ping fails', async () => {
      const pool = createMockSharedPool({}, 'error');

      const result = await healthChecker.checkSharedDbHealth(pool, true, 5000);

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Connection failed');
    });

    it('should skip ping when disabled', async () => {
      const pool = createMockSharedPool();

      const result = await healthChecker.checkSharedDbHealth(pool, false, 5000);

      expect(pool.query).not.toHaveBeenCalled();
      expect(result.responseTimeMs).toBeUndefined();
    });
  });

  describe('executePingQuery', () => {
    it('should return success for fast query', async () => {
      const pool = createMockSharedPool();

      const result = await healthChecker.executePingQuery(pool, 5000);

      expect(result.success).toBe(true);
      expect(result.responseTimeMs).toBeDefined();
      expect(result.responseTimeMs).toBeLessThan(100);
      expect(result.error).toBeUndefined();
    });

    it('should return failure for rejected query', async () => {
      const pool = createMockSharedPool({}, 'error');

      const result = await healthChecker.executePingQuery(pool, 5000);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
      expect(result.responseTimeMs).toBeDefined();
    });

    it('should timeout for slow query', async () => {
      const pool = createMockSharedPool({}, 'timeout');

      const result = await healthChecker.executePingQuery(pool, 50); // 50ms timeout

      expect(result.success).toBe(false);
      expect(result.error).toBe('Health check ping timeout');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(50);
    });
  });

  describe('determineOverallHealth', () => {
    it('should return true when all pools are healthy', () => {
      const pools = [
        { tenantId: 'abc', schemaName: 'tenant_abc', status: 'ok' as const, totalConnections: 5, idleConnections: 3, waitingRequests: 0 },
        { tenantId: 'xyz', schemaName: 'tenant_xyz', status: 'ok' as const, totalConnections: 5, idleConnections: 3, waitingRequests: 0 },
      ];

      const result = healthChecker.determineOverallHealth(pools);
      expect(result).toBe(true);
    });

    it('should return true when some pools are degraded', () => {
      const pools = [
        { tenantId: 'abc', schemaName: 'tenant_abc', status: 'ok' as const, totalConnections: 5, idleConnections: 3, waitingRequests: 0 },
        { tenantId: 'xyz', schemaName: 'tenant_xyz', status: 'degraded' as const, totalConnections: 5, idleConnections: 3, waitingRequests: 2 },
      ];

      const result = healthChecker.determineOverallHealth(pools);
      expect(result).toBe(true);
    });

    it('should return false when any pool is unhealthy', () => {
      const pools = [
        { tenantId: 'abc', schemaName: 'tenant_abc', status: 'ok' as const, totalConnections: 5, idleConnections: 3, waitingRequests: 0 },
        { tenantId: 'xyz', schemaName: 'tenant_xyz', status: 'unhealthy' as const, totalConnections: 5, idleConnections: 3, waitingRequests: 0, error: 'Connection lost' },
      ];

      const result = healthChecker.determineOverallHealth(pools);
      expect(result).toBe(false);
    });

    it('should return false when shared db is unhealthy', () => {
      const pools = [
        { tenantId: 'abc', schemaName: 'tenant_abc', status: 'ok' as const, totalConnections: 5, idleConnections: 3, waitingRequests: 0 },
      ];

      const result = healthChecker.determineOverallHealth(pools, 'unhealthy');
      expect(result).toBe(false);
    });

    it('should return true for empty pools', () => {
      const result = healthChecker.determineOverallHealth([]);
      expect(result).toBe(true);
    });
  });

  describe('use schemaName as fallback for tenantId', () => {
    it('should use schemaName when tenantId not found in map', async () => {
      const entry = createMockEntry('tenant_unknown');
      entries.set('tenant_unknown', entry);
      // Not setting tenantIdBySchema - should fall back to schemaName

      const result = await healthChecker.checkHealth({ ping: false });

      expect(result.pools).toHaveLength(1);
      expect(result.pools[0].tenantId).toBe('tenant_unknown');
    });
  });

  describe('parallel pool checks', () => {
    it('should check multiple pools in parallel', async () => {
      const queryDelay = 50;

      for (let i = 0; i < 5; i++) {
        const entry = createMockEntry(`tenant_${i}`);
        (entry.pool.query as any).mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ rows: [] }), queryDelay);
            })
        );
        entries.set(`tenant_${i}`, entry);
        tenantIdBySchema.set(`tenant_${i}`, `${i}`);
      }

      const start = Date.now();
      const result = await healthChecker.checkHealth({ ping: true });
      const duration = Date.now() - start;

      expect(result.pools).toHaveLength(5);
      // If parallel, should complete in ~queryDelay ms, not 5*queryDelay
      expect(duration).toBeLessThan(queryDelay * 3); // Allow some margin
    });
  });
});
