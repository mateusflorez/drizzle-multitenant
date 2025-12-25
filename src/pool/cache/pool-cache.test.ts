import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoolCache } from './pool-cache.js';
import type { PoolEntry } from '../../types.js';

// Mock pool entry factory
function createMockEntry(schemaName: string, lastAccess?: number): PoolEntry<Record<string, unknown>> {
  return {
    db: { mockDb: true } as any,
    pool: {
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
    } as any,
    lastAccess: lastAccess ?? Date.now(),
    schemaName,
  };
}

describe('PoolCache', () => {
  let cache: PoolCache<Record<string, unknown>>;
  let onDispose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onDispose = vi.fn();
    cache = new PoolCache({
      maxPools: 3,
      poolTtlMs: 1000,
      onDispose,
    });
  });

  describe('get/set', () => {
    it('should store and retrieve pool entries', () => {
      const entry = createMockEntry('tenant_abc');
      cache.set('tenant_abc', entry);

      const retrieved = cache.get('tenant_abc');
      expect(retrieved).toBe(entry);
    });

    it('should return undefined for non-existent entries', () => {
      const result = cache.get('non_existent');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing entries', () => {
      const entry1 = createMockEntry('tenant_abc');
      const entry2 = createMockEntry('tenant_abc');

      cache.set('tenant_abc', entry1);
      cache.set('tenant_abc', entry2);

      expect(cache.get('tenant_abc')).toBe(entry2);
    });
  });

  describe('has', () => {
    it('should return true for existing entries', () => {
      cache.set('tenant_abc', createMockEntry('tenant_abc'));
      expect(cache.has('tenant_abc')).toBe(true);
    });

    it('should return false for non-existent entries', () => {
      expect(cache.has('non_existent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete existing entries', () => {
      cache.set('tenant_abc', createMockEntry('tenant_abc'));
      const result = cache.delete('tenant_abc');

      expect(result).toBe(true);
      expect(cache.has('tenant_abc')).toBe(false);
    });

    it('should return false when deleting non-existent entries', () => {
      const result = cache.delete('non_existent');
      expect(result).toBe(false);
    });

    it('should call onDispose when deleting', async () => {
      const entry = createMockEntry('tenant_abc');
      cache.set('tenant_abc', entry);
      cache.delete('tenant_abc');

      // Wait for async dispose
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onDispose).toHaveBeenCalledWith('tenant_abc', entry);
    });
  });

  describe('size', () => {
    it('should return 0 for empty cache', () => {
      expect(cache.size()).toBe(0);
    });

    it('should return correct count of entries', () => {
      cache.set('tenant_1', createMockEntry('tenant_1'));
      cache.set('tenant_2', createMockEntry('tenant_2'));
      expect(cache.size()).toBe(2);
    });
  });

  describe('keys', () => {
    it('should return empty array for empty cache', () => {
      expect(cache.keys()).toEqual([]);
    });

    it('should return all schema names', () => {
      cache.set('tenant_1', createMockEntry('tenant_1'));
      cache.set('tenant_2', createMockEntry('tenant_2'));

      const keys = cache.keys();
      expect(keys).toHaveLength(2);
      expect(keys).toContain('tenant_1');
      expect(keys).toContain('tenant_2');
    });
  });

  describe('entries', () => {
    it('should iterate over all entries', () => {
      const entry1 = createMockEntry('tenant_1');
      const entry2 = createMockEntry('tenant_2');
      cache.set('tenant_1', entry1);
      cache.set('tenant_2', entry2);

      const entries = Array.from(cache.entries());
      expect(entries).toHaveLength(2);

      const map = new Map(entries);
      expect(map.get('tenant_1')).toBe(entry1);
      expect(map.get('tenant_2')).toBe(entry2);
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      cache.set('tenant_1', createMockEntry('tenant_1'));
      cache.set('tenant_2', createMockEntry('tenant_2'));

      await cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has('tenant_1')).toBe(false);
      expect(cache.has('tenant_2')).toBe(false);
    });

    it('should call onDispose for all entries', async () => {
      const entry1 = createMockEntry('tenant_1');
      const entry2 = createMockEntry('tenant_2');
      cache.set('tenant_1', entry1);
      cache.set('tenant_2', entry2);

      await cache.clear();

      expect(onDispose).toHaveBeenCalledTimes(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict LRU entry when max is reached', async () => {
      cache.set('tenant_1', createMockEntry('tenant_1'));
      cache.set('tenant_2', createMockEntry('tenant_2'));
      cache.set('tenant_3', createMockEntry('tenant_3'));

      // Access tenant_1 to make it recently used
      cache.get('tenant_1');

      // Add a 4th tenant - should evict tenant_2 (LRU)
      cache.set('tenant_4', createMockEntry('tenant_4'));

      expect(cache.size()).toBe(3);
      expect(cache.has('tenant_1')).toBe(true);
      expect(cache.has('tenant_2')).toBe(false); // evicted
      expect(cache.has('tenant_3')).toBe(true);
      expect(cache.has('tenant_4')).toBe(true);

      // Wait for dispose callback
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onDispose).toHaveBeenCalled();
    });

    it('should manually evict LRU entry', () => {
      cache.set('tenant_1', createMockEntry('tenant_1'));
      cache.set('tenant_2', createMockEntry('tenant_2'));

      const evicted = cache.evictLRU();

      expect(evicted).toBe('tenant_1');
      expect(cache.size()).toBe(1);
      expect(cache.has('tenant_2')).toBe(true);
    });

    it('should return undefined when evicting from empty cache', () => {
      const evicted = cache.evictLRU();
      expect(evicted).toBeUndefined();
    });
  });

  describe('TTL expiration', () => {
    it('should identify expired entries', () => {
      const oldEntry = createMockEntry('tenant_old', Date.now() - 2000); // 2 seconds ago
      const newEntry = createMockEntry('tenant_new', Date.now());

      expect(cache.isExpired(oldEntry)).toBe(true);
      expect(cache.isExpired(newEntry)).toBe(false);
    });

    it('should evict expired entries', async () => {
      const oldEntry = createMockEntry('tenant_old', Date.now() - 2000);
      const newEntry = createMockEntry('tenant_new', Date.now());

      cache.set('tenant_old', oldEntry);
      cache.set('tenant_new', newEntry);

      const evicted = await cache.evictExpired();

      expect(evicted).toEqual(['tenant_old']);
      expect(cache.has('tenant_old')).toBe(false);
      expect(cache.has('tenant_new')).toBe(true);
    });

    it('should return empty array when no TTL configured', async () => {
      const cacheNoTtl = new PoolCache({ maxPools: 3 });
      cacheNoTtl.set('tenant_1', createMockEntry('tenant_1', Date.now() - 10000));

      const evicted = await cacheNoTtl.evictExpired();
      expect(evicted).toEqual([]);
    });
  });

  describe('touch', () => {
    it('should update last access time', () => {
      const entry = createMockEntry('tenant_abc', Date.now() - 5000);
      cache.set('tenant_abc', entry);

      const oldAccess = entry.lastAccess;

      // Small delay to ensure time difference
      cache.touch('tenant_abc');

      expect(entry.lastAccess).toBeGreaterThan(oldAccess);
    });

    it('should not throw for non-existent entries', () => {
      expect(() => cache.touch('non_existent')).not.toThrow();
    });
  });

  describe('getMaxPools', () => {
    it('should return configured max pools', () => {
      expect(cache.getMaxPools()).toBe(3);
    });
  });

  describe('getTtlMs', () => {
    it('should return configured TTL', () => {
      expect(cache.getTtlMs()).toBe(1000);
    });

    it('should return undefined when no TTL configured', () => {
      const cacheNoTtl = new PoolCache({ maxPools: 3 });
      expect(cacheNoTtl.getTtlMs()).toBeUndefined();
    });
  });

  describe('no onDispose callback', () => {
    it('should work without onDispose callback', async () => {
      const cacheNoDispose = new PoolCache({ maxPools: 2 });
      cacheNoDispose.set('tenant_1', createMockEntry('tenant_1'));
      cacheNoDispose.set('tenant_2', createMockEntry('tenant_2'));

      // Should not throw
      cacheNoDispose.delete('tenant_1');
      await cacheNoDispose.clear();

      expect(cacheNoDispose.size()).toBe(0);
    });
  });

  describe('isExpired without TTL', () => {
    it('should always return false when no TTL configured', () => {
      const cacheNoTtl = new PoolCache({ maxPools: 3 });
      const oldEntry = createMockEntry('tenant_old', Date.now() - 999999999);

      expect(cacheNoTtl.isExpired(oldEntry)).toBe(false);
    });
  });
});
