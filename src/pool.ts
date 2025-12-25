import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { LRUCache } from 'lru-cache';
import type {
  Config,
  PoolEntry,
  TenantDb,
  SharedDb,
  WarmupOptions,
  WarmupResult,
  TenantWarmupResult,
} from './types.js';
import { DEFAULT_CONFIG as defaults } from './types.js';
import { createDebugLogger, DebugLogger } from './debug.js';

/**
 * Pool manager that handles tenant database connections with LRU eviction
 */
export class PoolManager<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
> {
  private readonly pools: LRUCache<string, PoolEntry<TTenantSchema>>;
  private readonly tenantIdBySchema: Map<string, string> = new Map();
  private sharedPool: Pool | null = null;
  private sharedDb: SharedDb<TSharedSchema> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly debugLogger: DebugLogger;

  constructor(private readonly config: Config<TTenantSchema, TSharedSchema>) {
    const maxPools = config.isolation.maxPools ?? defaults.maxPools;

    this.debugLogger = createDebugLogger(config.debug);

    this.pools = new LRUCache<string, PoolEntry<TTenantSchema>>({
      max: maxPools,
      dispose: (entry, key) => {
        this.disposePoolEntry(entry, key);
      },
      noDisposeOnSet: true,
    });
  }

  /**
   * Get or create a database connection for a tenant
   */
  getDb(tenantId: string): TenantDb<TTenantSchema> {
    this.ensureNotDisposed();

    const schemaName = this.config.isolation.schemaNameTemplate(tenantId);
    let entry = this.pools.get(schemaName);

    if (!entry) {
      entry = this.createPoolEntry(tenantId, schemaName);
      this.pools.set(schemaName, entry);
      this.tenantIdBySchema.set(schemaName, tenantId);

      // Log pool creation
      this.debugLogger.logPoolCreated(tenantId, schemaName);

      // Fire hook asynchronously
      void this.config.hooks?.onPoolCreated?.(tenantId);
    }

    entry.lastAccess = Date.now();
    return entry.db;
  }

  /**
   * Get or create the shared database connection
   */
  getSharedDb(): SharedDb<TSharedSchema> {
    this.ensureNotDisposed();

    if (!this.sharedDb) {
      this.sharedPool = new Pool({
        connectionString: this.config.connection.url,
        ...defaults.poolConfig,
        ...this.config.connection.poolConfig,
      });

      this.sharedPool.on('error', (err) => {
        void this.config.hooks?.onError?.('shared', err);
      });

      this.sharedDb = drizzle(this.sharedPool, {
        schema: this.config.schemas.shared,
      }) as SharedDb<TSharedSchema>;
    }

    return this.sharedDb;
  }

  /**
   * Get schema name for a tenant
   */
  getSchemaName(tenantId: string): string {
    return this.config.isolation.schemaNameTemplate(tenantId);
  }

  /**
   * Check if a pool exists for a tenant
   */
  hasPool(tenantId: string): boolean {
    const schemaName = this.config.isolation.schemaNameTemplate(tenantId);
    return this.pools.has(schemaName);
  }

  /**
   * Get count of active pools
   */
  getPoolCount(): number {
    return this.pools.size;
  }

  /**
   * Get all active tenant IDs
   */
  getActiveTenantIds(): string[] {
    return Array.from(this.tenantIdBySchema.values());
  }

  /**
   * Pre-warm pools for specified tenants to reduce cold start latency
   */
  async warmup(tenantIds: string[], options: WarmupOptions = {}): Promise<WarmupResult> {
    this.ensureNotDisposed();

    const startTime = Date.now();
    const { concurrency = 10, ping = true, onProgress } = options;
    const results: TenantWarmupResult[] = [];

    // Process in batches
    for (let i = 0; i < tenantIds.length; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          const tenantStart = Date.now();
          onProgress?.(tenantId, 'starting');

          try {
            const alreadyWarm = this.hasPool(tenantId);

            // Get or create pool
            const db = this.getDb(tenantId);

            // Execute ping query if requested
            if (ping && !alreadyWarm) {
              const schemaName = this.config.isolation.schemaNameTemplate(tenantId);
              const entry = this.pools.get(schemaName);
              if (entry) {
                await entry.pool.query('SELECT 1');
              }
            }

            const durationMs = Date.now() - tenantStart;
            onProgress?.(tenantId, 'completed');

            // Log warmup
            this.debugLogger.logWarmup(tenantId, true, durationMs, alreadyWarm);

            return {
              tenantId,
              success: true,
              alreadyWarm,
              durationMs,
            };
          } catch (error) {
            const durationMs = Date.now() - tenantStart;
            onProgress?.(tenantId, 'failed');

            // Log warmup failure
            this.debugLogger.logWarmup(tenantId, false, durationMs, false);

            return {
              tenantId,
              success: false,
              alreadyWarm: false,
              durationMs,
              error: (error as Error).message,
            };
          }
        })
      );

      results.push(...batchResults);
    }

    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      alreadyWarm: results.filter((r) => r.alreadyWarm).length,
      durationMs: Date.now() - startTime,
      details: results,
    };
  }

  /**
   * Manually evict a tenant pool
   */
  async evictPool(tenantId: string, reason: string = 'manual'): Promise<void> {
    const schemaName = this.config.isolation.schemaNameTemplate(tenantId);
    const entry = this.pools.get(schemaName);

    if (entry) {
      // Log eviction
      this.debugLogger.logPoolEvicted(tenantId, schemaName, reason);

      this.pools.delete(schemaName);
      this.tenantIdBySchema.delete(schemaName);
      await this.closePool(entry.pool, tenantId);
    }
  }

  /**
   * Start automatic cleanup of idle pools
   */
  startCleanup(): void {
    if (this.cleanupInterval) return;

    const poolTtlMs = this.config.isolation.poolTtlMs ?? defaults.poolTtlMs;
    const cleanupIntervalMs = defaults.cleanupIntervalMs;

    this.cleanupInterval = setInterval(() => {
      void this.cleanupIdlePools(poolTtlMs);
    }, cleanupIntervalMs);

    // Don't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Dispose all pools and cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    this.disposed = true;
    this.stopCleanup();

    // Close all tenant pools
    const closePromises: Promise<void>[] = [];

    for (const [schemaName, entry] of this.pools.entries()) {
      const tenantId = this.tenantIdBySchema.get(schemaName);
      closePromises.push(this.closePool(entry.pool, tenantId ?? schemaName));
    }

    this.pools.clear();
    this.tenantIdBySchema.clear();

    // Close shared pool
    if (this.sharedPool) {
      closePromises.push(this.closePool(this.sharedPool, 'shared'));
      this.sharedPool = null;
      this.sharedDb = null;
    }

    await Promise.all(closePromises);
  }

  /**
   * Create a new pool entry for a tenant
   */
  private createPoolEntry(tenantId: string, schemaName: string): PoolEntry<TTenantSchema> {
    const pool = new Pool({
      connectionString: this.config.connection.url,
      ...defaults.poolConfig,
      ...this.config.connection.poolConfig,
      options: `-c search_path=${schemaName},public`,
    });

    pool.on('error', async (err) => {
      // Log pool error
      this.debugLogger.logPoolError(tenantId, err);

      void this.config.hooks?.onError?.(tenantId, err);
      await this.evictPool(tenantId, 'error');
    });

    const db = drizzle(pool, {
      schema: this.config.schemas.tenant,
    }) as TenantDb<TTenantSchema>;

    return {
      db,
      pool,
      lastAccess: Date.now(),
      schemaName,
    };
  }

  /**
   * Dispose a pool entry (called by LRU cache)
   */
  private disposePoolEntry(entry: PoolEntry<TTenantSchema>, schemaName: string): void {
    const tenantId = this.tenantIdBySchema.get(schemaName);
    this.tenantIdBySchema.delete(schemaName);

    // Log pool eviction
    if (tenantId) {
      this.debugLogger.logPoolEvicted(tenantId, schemaName, 'lru_eviction');
    }

    void this.closePool(entry.pool, tenantId ?? schemaName).then(() => {
      if (tenantId) {
        void this.config.hooks?.onPoolEvicted?.(tenantId);
      }
    });
  }

  /**
   * Close a pool gracefully
   */
  private async closePool(pool: Pool, identifier: string): Promise<void> {
    try {
      await pool.end();
    } catch (error) {
      void this.config.hooks?.onError?.(identifier, error as Error);
    }
  }

  /**
   * Cleanup pools that have been idle for too long
   */
  private async cleanupIdlePools(poolTtlMs: number): Promise<void> {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [schemaName, entry] of this.pools.entries()) {
      if (now - entry.lastAccess > poolTtlMs) {
        toEvict.push(schemaName);
      }
    }

    for (const schemaName of toEvict) {
      const tenantId = this.tenantIdBySchema.get(schemaName);
      if (tenantId) {
        await this.evictPool(tenantId, 'ttl_expired');
      }
    }
  }

  /**
   * Ensure the manager hasn't been disposed
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('[drizzle-multitenant] TenantManager has been disposed');
    }
  }
}
