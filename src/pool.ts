import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type {
  Config,
  PoolEntry,
  TenantDb,
  SharedDb,
  WarmupOptions,
  WarmupResult,
  TenantWarmupResult,
  RetryConfig,
  HealthCheckOptions,
  HealthCheckResult,
  MetricsResult,
  TenantPoolMetrics,
} from './types.js';
import { DEFAULT_CONFIG as defaults } from './types.js';
import { createDebugLogger, DebugLogger } from './debug.js';
import { PoolCache } from './pool/cache/index.js';
import { RetryHandler } from './pool/retry/index.js';
import { HealthChecker } from './pool/health/index.js';

/**
 * Pool manager that handles tenant database connections with LRU eviction
 */
export class PoolManager<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
> {
  private readonly poolCache: PoolCache<TTenantSchema>;
  private readonly tenantIdBySchema: Map<string, string> = new Map();
  private readonly pendingConnections: Map<string, Promise<PoolEntry<TTenantSchema>>> = new Map();
  private sharedPool: Pool | null = null;
  private sharedDb: SharedDb<TSharedSchema> | null = null;
  private sharedDbPending: Promise<SharedDb<TSharedSchema>> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly debugLogger: DebugLogger;
  private readonly retryHandler: RetryHandler;
  private readonly healthChecker: HealthChecker<TTenantSchema>;

  constructor(private readonly config: Config<TTenantSchema, TSharedSchema>) {
    const maxPools = config.isolation.maxPools ?? defaults.maxPools;
    const poolTtlMs = config.isolation.poolTtlMs ?? defaults.poolTtlMs;

    this.debugLogger = createDebugLogger(config.debug);

    // Initialize retry handler with config
    this.retryHandler = new RetryHandler(config.connection.retry);

    this.poolCache = new PoolCache<TTenantSchema>({
      maxPools,
      poolTtlMs,
      onDispose: (schemaName, entry) => {
        this.disposePoolEntry(entry, schemaName);
      },
    });

    // Initialize health checker with dependencies
    this.healthChecker = new HealthChecker<TTenantSchema>({
      getPoolEntries: () => this.poolCache.entries(),
      getTenantIdBySchema: (schemaName) => this.tenantIdBySchema.get(schemaName),
      getPoolEntry: (schemaName) => this.poolCache.get(schemaName),
      getSchemaName: (tenantId) => this.config.isolation.schemaNameTemplate(tenantId),
      getSharedPool: () => this.sharedPool,
    });
  }

  /**
   * Get or create a database connection for a tenant
   */
  getDb(tenantId: string): TenantDb<TTenantSchema> {
    this.ensureNotDisposed();

    const schemaName = this.config.isolation.schemaNameTemplate(tenantId);
    let entry = this.poolCache.get(schemaName);

    if (!entry) {
      entry = this.createPoolEntry(tenantId, schemaName);
      this.poolCache.set(schemaName, entry);
      this.tenantIdBySchema.set(schemaName, tenantId);

      // Log pool creation
      this.debugLogger.logPoolCreated(tenantId, schemaName);

      // Fire hook asynchronously
      void this.config.hooks?.onPoolCreated?.(tenantId);
    }

    this.poolCache.touch(schemaName);
    return entry.db;
  }

  /**
   * Get or create a database connection for a tenant with retry and validation
   *
   * This async version validates the connection by executing a ping query
   * and retries on transient failures with exponential backoff.
   *
   * @example
   * ```typescript
   * // Get tenant database with automatic retry
   * const db = await manager.getDbAsync('tenant-123');
   *
   * // Queries will use the validated connection
   * const users = await db.select().from(users);
   * ```
   */
  async getDbAsync(tenantId: string): Promise<TenantDb<TTenantSchema>> {
    this.ensureNotDisposed();

    const schemaName = this.config.isolation.schemaNameTemplate(tenantId);
    let entry = this.poolCache.get(schemaName);

    if (entry) {
      this.poolCache.touch(schemaName);
      return entry.db;
    }

    // Check if there's already a pending connection for this tenant
    const pending = this.pendingConnections.get(schemaName);
    if (pending) {
      entry = await pending;
      this.poolCache.touch(schemaName);
      return entry.db;
    }

    // Create connection with retry
    const connectionPromise = this.connectWithRetry(tenantId, schemaName);
    this.pendingConnections.set(schemaName, connectionPromise);

    try {
      entry = await connectionPromise;
      this.poolCache.set(schemaName, entry);
      this.tenantIdBySchema.set(schemaName, tenantId);

      // Log pool creation
      this.debugLogger.logPoolCreated(tenantId, schemaName);

      // Fire hook asynchronously
      void this.config.hooks?.onPoolCreated?.(tenantId);

      this.poolCache.touch(schemaName);
      return entry.db;
    } finally {
      this.pendingConnections.delete(schemaName);
    }
  }

  /**
   * Connect to a tenant database with retry logic
   */
  private async connectWithRetry(
    tenantId: string,
    schemaName: string
  ): Promise<PoolEntry<TTenantSchema>> {
    const retryConfig = this.retryHandler.getConfig();
    const maxAttempts = retryConfig.maxAttempts;

    const result = await this.retryHandler.withRetry(
      async () => {
        // Create pool entry
        const entry = this.createPoolEntry(tenantId, schemaName);

        try {
          // Validate connection with ping query
          await entry.pool.query('SELECT 1');
          return entry;
        } catch (error) {
          // Clean up failed pool before retrying
          try {
            await entry.pool.end();
          } catch {
            // Ignore cleanup errors
          }
          throw error;
        }
      },
      {
        onRetry: (attempt, error, delayMs) => {
          // Log retry event
          this.debugLogger.logConnectionRetry(tenantId, attempt, maxAttempts, error, delayMs);

          // Call user-provided onRetry hook
          retryConfig.onRetry?.(attempt, error, delayMs);
        },
      }
    );

    // Log success if multiple attempts were needed
    this.debugLogger.logConnectionSuccess(tenantId, result.attempts, result.totalTimeMs);

    return result.result;
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
   * Get or create the shared database connection with retry and validation
   *
   * This async version validates the connection by executing a ping query
   * and retries on transient failures with exponential backoff.
   *
   * @example
   * ```typescript
   * // Get shared database with automatic retry
   * const sharedDb = await manager.getSharedDbAsync();
   *
   * // Queries will use the validated connection
   * const plans = await sharedDb.select().from(plans);
   * ```
   */
  async getSharedDbAsync(): Promise<SharedDb<TSharedSchema>> {
    this.ensureNotDisposed();

    if (this.sharedDb) {
      return this.sharedDb;
    }

    // Check if there's already a pending connection
    if (this.sharedDbPending) {
      return this.sharedDbPending;
    }

    // Create connection with retry
    this.sharedDbPending = this.connectSharedWithRetry();

    try {
      const db = await this.sharedDbPending;
      return db;
    } finally {
      this.sharedDbPending = null;
    }
  }

  /**
   * Connect to shared database with retry logic
   */
  private async connectSharedWithRetry(): Promise<SharedDb<TSharedSchema>> {
    const retryConfig = this.retryHandler.getConfig();
    const maxAttempts = retryConfig.maxAttempts;

    const result = await this.retryHandler.withRetry(
      async () => {
        const pool = new Pool({
          connectionString: this.config.connection.url,
          ...defaults.poolConfig,
          ...this.config.connection.poolConfig,
        });

        try {
          // Validate connection with ping query
          await pool.query('SELECT 1');

          pool.on('error', (err) => {
            void this.config.hooks?.onError?.('shared', err);
          });

          this.sharedPool = pool;
          this.sharedDb = drizzle(pool, {
            schema: this.config.schemas.shared,
          }) as SharedDb<TSharedSchema>;

          return this.sharedDb;
        } catch (error) {
          // Clean up failed pool before retrying
          try {
            await pool.end();
          } catch {
            // Ignore cleanup errors
          }
          throw error;
        }
      },
      {
        onRetry: (attempt, error, delayMs) => {
          // Log retry event
          this.debugLogger.logConnectionRetry('shared', attempt, maxAttempts, error, delayMs);

          // Call user-provided onRetry hook
          retryConfig.onRetry?.(attempt, error, delayMs);
        },
      }
    );

    // Log success if multiple attempts were needed
    this.debugLogger.logConnectionSuccess('shared', result.attempts, result.totalTimeMs);

    return result.result;
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
    return this.poolCache.has(schemaName);
  }

  /**
   * Get count of active pools
   */
  getPoolCount(): number {
    return this.poolCache.size();
  }

  /**
   * Get all active tenant IDs
   */
  getActiveTenantIds(): string[] {
    return Array.from(this.tenantIdBySchema.values());
  }

  /**
   * Get the retry configuration
   */
  getRetryConfig(): Required<RetryConfig> {
    return this.retryHandler.getConfig();
  }

  /**
   * Pre-warm pools for specified tenants to reduce cold start latency
   *
   * Uses automatic retry with exponential backoff for connection failures.
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

            // Use getDbAsync which includes retry logic and ping validation
            if (ping) {
              await this.getDbAsync(tenantId);
            } else {
              // For backward compatibility: sync version without ping
              this.getDb(tenantId);
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
   * Get current metrics for all pools
   *
   * Collects metrics on demand with zero overhead when not called.
   * Returns raw data that can be formatted for any monitoring system.
   *
   * @example
   * ```typescript
   * const metrics = manager.getMetrics();
   * console.log(metrics.pools.total); // 15
   *
   * // Format for Prometheus
   * for (const pool of metrics.pools.tenants) {
   *   gauge.labels(pool.tenantId).set(pool.connections.idle);
   * }
   * ```
   */
  getMetrics(): MetricsResult {
    this.ensureNotDisposed();

    const maxPools = this.config.isolation.maxPools ?? defaults.maxPools;
    const tenantMetrics: TenantPoolMetrics[] = [];

    for (const [schemaName, entry] of this.poolCache.entries()) {
      const tenantId = this.tenantIdBySchema.get(schemaName) ?? schemaName;
      const pool = entry.pool;

      tenantMetrics.push({
        tenantId,
        schemaName,
        connections: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
        lastAccessedAt: new Date(entry.lastAccess).toISOString(),
      });
    }

    return {
      pools: {
        total: tenantMetrics.length,
        maxPools,
        tenants: tenantMetrics,
      },
      shared: {
        initialized: this.sharedPool !== null,
        connections: this.sharedPool
          ? {
              total: this.sharedPool.totalCount,
              idle: this.sharedPool.idleCount,
              waiting: this.sharedPool.waitingCount,
            }
          : null,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check health of all pools and connections
   *
   * Verifies the health of tenant pools and optionally the shared database.
   * Returns detailed status information for monitoring and load balancer integration.
   *
   * @example
   * ```typescript
   * // Basic health check
   * const health = await manager.healthCheck();
   * console.log(health.healthy); // true/false
   *
   * // Use with Express endpoint
   * app.get('/health', async (req, res) => {
   *   const health = await manager.healthCheck();
   *   res.status(health.healthy ? 200 : 503).json(health);
   * });
   *
   * // Check specific tenants only
   * const health = await manager.healthCheck({
   *   tenantIds: ['tenant-1', 'tenant-2'],
   *   ping: true,
   *   pingTimeoutMs: 3000,
   * });
   * ```
   */
  async healthCheck(options: HealthCheckOptions = {}): Promise<HealthCheckResult> {
    this.ensureNotDisposed();
    return this.healthChecker.checkHealth(options);
  }

  /**
   * Manually evict a tenant pool
   */
  async evictPool(tenantId: string, reason: string = 'manual'): Promise<void> {
    const schemaName = this.config.isolation.schemaNameTemplate(tenantId);
    const entry = this.poolCache.get(schemaName);

    if (entry) {
      // Log eviction
      this.debugLogger.logPoolEvicted(tenantId, schemaName, reason);

      this.poolCache.delete(schemaName);
      this.tenantIdBySchema.delete(schemaName);
      await this.closePool(entry.pool, tenantId);
    }
  }

  /**
   * Start automatic cleanup of idle pools
   */
  startCleanup(): void {
    if (this.cleanupInterval) return;

    const cleanupIntervalMs = defaults.cleanupIntervalMs;

    this.cleanupInterval = setInterval(() => {
      void this.cleanupIdlePools();
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

    for (const [schemaName, entry] of this.poolCache.entries()) {
      const tenantId = this.tenantIdBySchema.get(schemaName);
      closePromises.push(this.closePool(entry.pool, tenantId ?? schemaName));
    }

    await this.poolCache.clear();
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
  private async cleanupIdlePools(): Promise<void> {
    const evictedSchemas = await this.poolCache.evictExpired();

    for (const schemaName of evictedSchemas) {
      const tenantId = this.tenantIdBySchema.get(schemaName);
      if (tenantId) {
        this.debugLogger.logPoolEvicted(tenantId, schemaName, 'ttl_expired');
        this.tenantIdBySchema.delete(schemaName);
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
