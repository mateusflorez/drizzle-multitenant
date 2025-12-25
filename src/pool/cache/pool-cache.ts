/**
 * PoolCache - LRU cache for tenant database pools
 *
 * Extracted from PoolManager as part of the god component refactoring.
 * Handles all cache-related operations with LRU eviction.
 *
 * @see REFACTOR_PROPOSAL.md
 */

import { LRUCache } from 'lru-cache';
import type { PoolEntry } from '../../types.js';
import type { IPoolCache, PoolCacheOptions } from '../interfaces.js';

/**
 * LRU cache for tenant database pools
 *
 * Provides efficient pool management with automatic LRU eviction
 * when the maximum pool count is reached.
 *
 * @example
 * ```typescript
 * const cache = new PoolCache<MySchema>({
 *   maxPools: 50,
 *   poolTtlMs: 3600000, // 1 hour
 *   onDispose: async (schemaName, entry) => {
 *     await entry.pool.end();
 *   },
 * });
 *
 * cache.set('tenant_abc', poolEntry);
 * const entry = cache.get('tenant_abc');
 * ```
 */
export class PoolCache<TSchema extends Record<string, unknown> = Record<string, unknown>>
  implements IPoolCache<TSchema>
{
  private readonly cache: LRUCache<string, PoolEntry<TSchema>>;
  private readonly poolTtlMs?: number;
  private readonly onDispose?: (
    schemaName: string,
    entry: PoolEntry<TSchema>
  ) => void | Promise<void>;

  constructor(options: PoolCacheOptions) {
    this.poolTtlMs = options.poolTtlMs;
    this.onDispose = options.onDispose as typeof this.onDispose;

    this.cache = new LRUCache<string, PoolEntry<TSchema>>({
      max: options.maxPools,
      dispose: (entry, key) => {
        void this.handleDispose(key, entry);
      },
      noDisposeOnSet: true,
    });
  }

  /**
   * Get a pool entry from cache
   *
   * This does NOT update the last access time automatically.
   * Use `touch()` to update access time when needed.
   */
  get(schemaName: string): PoolEntry<TSchema> | undefined {
    return this.cache.get(schemaName);
  }

  /**
   * Set a pool entry in cache
   *
   * If the cache is full, the least recently used entry will be evicted.
   */
  set(schemaName: string, entry: PoolEntry<TSchema>): void {
    this.cache.set(schemaName, entry);
  }

  /**
   * Check if a pool exists in cache
   */
  has(schemaName: string): boolean {
    return this.cache.has(schemaName);
  }

  /**
   * Delete a pool from cache
   *
   * Note: This triggers the dispose callback if configured.
   */
  delete(schemaName: string): boolean {
    return this.cache.delete(schemaName);
  }

  /**
   * Get the number of pools in cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get all schema names in cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Iterate over all entries in cache
   *
   * @yields [schemaName, entry] pairs
   */
  *entries(): IterableIterator<[string, PoolEntry<TSchema>]> {
    for (const [key, value] of this.cache.entries()) {
      yield [key, value];
    }
  }

  /**
   * Clear all pools from cache
   *
   * Each pool's dispose callback will be triggered by the LRU cache.
   */
  async clear(): Promise<void> {
    // Clear the cache (triggers dispose for each via LRU callback)
    this.cache.clear();

    // Small delay to allow dispose callbacks to complete
    await Promise.resolve();
  }

  /**
   * Evict the least recently used pool
   *
   * @returns The schema name of the evicted pool, or undefined if cache is empty
   */
  evictLRU(): string | undefined {
    // Get keys in LRU order (least recently used first)
    const keys = Array.from(this.cache.keys());
    if (keys.length === 0) {
      return undefined;
    }

    // The last key in iteration is the least recently used
    // because LRUCache iterates from newest to oldest
    const lruKey = keys[keys.length - 1];
    this.cache.delete(lruKey);
    return lruKey;
  }

  /**
   * Evict pools that have exceeded TTL
   *
   * @returns Array of schema names that were evicted
   */
  async evictExpired(): Promise<string[]> {
    if (!this.poolTtlMs) {
      return [];
    }

    const now = Date.now();
    const toEvict: string[] = [];

    for (const [schemaName, entry] of this.cache.entries()) {
      if (now - entry.lastAccess > this.poolTtlMs) {
        toEvict.push(schemaName);
      }
    }

    // Evict expired pools
    for (const schemaName of toEvict) {
      this.cache.delete(schemaName);
    }

    return toEvict;
  }

  /**
   * Update last access time for a pool
   *
   * This moves the pool to the front of the LRU list.
   */
  touch(schemaName: string): void {
    const entry = this.cache.get(schemaName);
    if (entry) {
      entry.lastAccess = Date.now();
    }
  }

  /**
   * Get the maximum number of pools allowed in cache
   */
  getMaxPools(): number {
    return this.cache.max;
  }

  /**
   * Get the configured TTL in milliseconds
   */
  getTtlMs(): number | undefined {
    return this.poolTtlMs;
  }

  /**
   * Check if an entry has expired based on TTL
   */
  isExpired(entry: PoolEntry<TSchema>): boolean {
    if (!this.poolTtlMs) {
      return false;
    }
    return Date.now() - entry.lastAccess > this.poolTtlMs;
  }

  /**
   * Handle disposal of a cache entry
   */
  private async handleDispose(schemaName: string, entry: PoolEntry<TSchema>): Promise<void> {
    if (this.onDispose) {
      await this.onDispose(schemaName, entry);
    }
  }
}
