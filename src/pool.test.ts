import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PoolManager } from './pool.js';
import type { Config } from './types.js';

// Mock pg
vi.mock('pg', () => {
  const mockPool = {
    on: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return {
    Pool: vi.fn(() => mockPool),
  };
});

// Mock drizzle-orm
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({ mockDb: true })),
}));

describe('PoolManager', () => {
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

  describe('getDb', () => {
    it('should return a database instance for a tenant', () => {
      const db = manager.getDb('tenant-1');
      expect(db).toBeDefined();
      expect(db).toHaveProperty('mockDb', true);
    });

    it('should return the same instance for the same tenant', () => {
      const db1 = manager.getDb('tenant-1');
      const db2 = manager.getDb('tenant-1');
      expect(db1).toBe(db2);
    });

    it('should return different instances for different tenants', () => {
      const db1 = manager.getDb('tenant-1');
      const db2 = manager.getDb('tenant-2');
      // Both are mocked, but hasPool should show different pools
      expect(manager.hasPool('tenant-1')).toBe(true);
      expect(manager.hasPool('tenant-2')).toBe(true);
    });

    it('should call onPoolCreated hook when creating new pool', async () => {
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
  });

  describe('getSharedDb', () => {
    it('should return a shared database instance', () => {
      const db = manager.getSharedDb();
      expect(db).toBeDefined();
    });

    it('should return the same shared instance on multiple calls', () => {
      const db1 = manager.getSharedDb();
      const db2 = manager.getSharedDb();
      expect(db1).toBe(db2);
    });
  });

  describe('getSchemaName', () => {
    it('should return the schema name for a tenant', () => {
      expect(manager.getSchemaName('abc-123')).toBe('tenant_abc-123');
    });
  });

  describe('hasPool', () => {
    it('should return false for non-existent pool', () => {
      expect(manager.hasPool('tenant-1')).toBe(false);
    });

    it('should return true for existing pool', () => {
      manager.getDb('tenant-1');
      expect(manager.hasPool('tenant-1')).toBe(true);
    });
  });

  describe('getPoolCount', () => {
    it('should return 0 initially', () => {
      expect(manager.getPoolCount()).toBe(0);
    });

    it('should return correct count after creating pools', () => {
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');
      expect(manager.getPoolCount()).toBe(2);
    });
  });

  describe('getActiveTenantIds', () => {
    it('should return empty array initially', () => {
      expect(manager.getActiveTenantIds()).toEqual([]);
    });

    it('should return active tenant IDs', () => {
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');
      const ids = manager.getActiveTenantIds();
      expect(ids).toContain('tenant-1');
      expect(ids).toContain('tenant-2');
    });
  });

  describe('evictPool', () => {
    it('should remove a pool', async () => {
      manager.getDb('tenant-1');
      expect(manager.hasPool('tenant-1')).toBe(true);

      await manager.evictPool('tenant-1');
      expect(manager.hasPool('tenant-1')).toBe(false);
    });

    it('should handle evicting non-existent pool', async () => {
      await expect(manager.evictPool('non-existent')).resolves.not.toThrow();
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest pool when maxPools is reached', () => {
      // maxPools is 3 in config
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');
      manager.getDb('tenant-3');
      expect(manager.getPoolCount()).toBe(3);

      // Adding 4th should evict oldest
      manager.getDb('tenant-4');
      expect(manager.getPoolCount()).toBe(3);
      expect(manager.hasPool('tenant-1')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should dispose all pools', async () => {
      manager.getDb('tenant-1');
      manager.getDb('tenant-2');
      manager.getSharedDb();

      await manager.dispose();

      expect(manager.getPoolCount()).toBe(0);
    });

    it('should throw when using manager after dispose', async () => {
      await manager.dispose();
      expect(() => manager.getDb('tenant-1')).toThrow('has been disposed');
    });

    it('should be idempotent', async () => {
      await manager.dispose();
      await expect(manager.dispose()).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start cleanup interval', () => {
      manager.startCleanup();
      // Just verify no error
    });

    it('should stop cleanup interval', () => {
      manager.startCleanup();
      manager.stopCleanup();
      // Just verify no error
    });
  });
});
