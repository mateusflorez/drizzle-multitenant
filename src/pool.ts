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
  PoolHealth,
  PoolHealthStatus,
  MetricsResult,
  TenantPoolMetrics,
} from './types.js';
import { DEFAULT_CONFIG as defaults } from './types.js';
import { createDebugLogger, DebugLogger } from './debug.js';
import { withRetry, isRetryableError } from './retry.js';
import { PoolCache } from './pool/cache/index.js';

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
  private readonly retryConfig: Required<RetryConfig>;

  constructor(private readonly config: Config<TTenantSchema, TSharedSchema>) {
    const maxPools = config.isolation.maxPools ?? defaults.maxPools;
    const poolTtlMs = config.isolation.poolTtlMs ?? defaults.poolTtlMs;

    this.debugLogger = createDebugLogger(config.debug);

    // Initialize retry config with defaults
    const userRetry = config.connection.retry ?? {};
    this.retryConfig = {
      maxAttempts: userRetry.maxAttempts ?? defaults.retry.maxAttempts,
      initialDelayMs: userRetry.initialDelayMs ?? defaults.retry.initialDelayMs,
      maxDelayMs: userRetry.maxDelayMs ?? defaults.retry.maxDelayMs,
      backoffMultiplier: userRetry.backoffMultiplier ?? defaults.retry.backoffMultiplier,
      jitter: userRetry.jitter ?? defaults.retry.jitter,
      isRetryable: userRetry.isRetryable ?? isRetryableError,
      onRetry: userRetry.onRetry,
    };

    this.poolCache = new PoolCache<TTenantSchema>({
      maxPools,
      poolTtlMs,
      onDispose: (schemaName, entry) => {
        this.disposePoolEntry(entry, schemaName);
      },
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
    const maxAttempts = this.retryConfig.maxAttempts;

    const result = await withRetry(
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
        ...this.retryConfig,
        onRetry: (attempt, error, delayMs) => {
          // Log retry event
          this.debugLogger.logConnectionRetry(tenantId, attempt, maxAttempts, error, delayMs);

          // Call user-provided onRetry hook
          this.retryConfig.onRetry?.(attempt, error, delayMs);
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
    const maxAttempts = this.retryConfig.maxAttempts;

    const result = await withRetry(
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
        ...this.retryConfig,
        onRetry: (attempt, error, delayMs) => {
          // Log retry event
          this.debugLogger.logConnectionRetry('shared', attempt, maxAttempts, error, delayMs);

          // Call user-provided onRetry hook
          this.retryConfig.onRetry?.(attempt, error, delayMs);
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
    return { ...this.retryConfig };
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

    const startTime = Date.now();
    const {
      ping = true,
      pingTimeoutMs = 5000,
      includeShared = true,
      tenantIds,
    } = options;

    const poolHealthResults: PoolHealth[] = [];
    let sharedDbStatus: PoolHealthStatus = 'ok';
    let sharedDbResponseTimeMs: number | undefined;
    let sharedDbError: string | undefined;

    // Determine which pools to check
    const poolsToCheck: Array<{ schemaName: string; tenantId: string; entry: PoolEntry<TTenantSchema> }> = [];

    if (tenantIds && tenantIds.length > 0) {
      // Check only specified tenants
      for (const tenantId of tenantIds) {
        const schemaName = this.config.isolation.schemaNameTemplate(tenantId);
        const entry = this.poolCache.get(schemaName);
        if (entry) {
          poolsToCheck.push({ schemaName, tenantId, entry });
        }
      }
    } else {
      // Check all active pools
      for (const [schemaName, entry] of this.poolCache.entries()) {
        const tenantId = this.tenantIdBySchema.get(schemaName) ?? schemaName;
        poolsToCheck.push({ schemaName, tenantId, entry });
      }
    }

    // Check tenant pools in parallel
    const poolChecks = poolsToCheck.map(async ({ schemaName, tenantId, entry }) => {
      const poolHealth = await this.checkPoolHealth(tenantId, schemaName, entry, ping, pingTimeoutMs);
      return poolHealth;
    });

    poolHealthResults.push(...(await Promise.all(poolChecks)));

    // Check shared database
    if (includeShared && this.sharedPool) {
      const sharedResult = await this.checkSharedDbHealth(ping, pingTimeoutMs);
      sharedDbStatus = sharedResult.status;
      sharedDbResponseTimeMs = sharedResult.responseTimeMs;
      sharedDbError = sharedResult.error;
    }

    // Calculate aggregate stats
    const degradedPools = poolHealthResults.filter((p) => p.status === 'degraded').length;
    const unhealthyPools = poolHealthResults.filter((p) => p.status === 'unhealthy').length;

    // Overall health: healthy if no unhealthy pools and shared db is ok
    const healthy = unhealthyPools === 0 && sharedDbStatus !== 'unhealthy';

    return {
      healthy,
      pools: poolHealthResults,
      sharedDb: sharedDbStatus,
      sharedDbResponseTimeMs,
      sharedDbError,
      totalPools: poolHealthResults.length,
      degradedPools,
      unhealthyPools,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Check health of a single tenant pool
   */
  private async checkPoolHealth(
    tenantId: string,
    schemaName: string,
    entry: PoolEntry<TTenantSchema>,
    ping: boolean,
    pingTimeoutMs: number
  ): Promise<PoolHealth> {
    const pool = entry.pool;
    const totalConnections = pool.totalCount;
    const idleConnections = pool.idleCount;
    const waitingRequests = pool.waitingCount;

    let status: PoolHealthStatus = 'ok';
    let responseTimeMs: number | undefined;
    let error: string | undefined;

    // Determine status based on pool metrics
    if (waitingRequests > 0) {
      status = 'degraded';
    }

    // Execute ping query if requested
    if (ping) {
      const pingResult = await this.executePingQuery(pool, pingTimeoutMs);
      responseTimeMs = pingResult.responseTimeMs;

      if (!pingResult.success) {
        status = 'unhealthy';
        error = pingResult.error;
      } else if (pingResult.responseTimeMs && pingResult.responseTimeMs > pingTimeoutMs / 2) {
        // Slow response indicates degraded status
        if (status === 'ok') {
          status = 'degraded';
        }
      }
    }

    return {
      tenantId,
      schemaName,
      status,
      totalConnections,
      idleConnections,
      waitingRequests,
      responseTimeMs,
      error,
    };
  }

  /**
   * Check health of shared database
   */
  private async checkSharedDbHealth(
    ping: boolean,
    pingTimeoutMs: number
  ): Promise<{ status: PoolHealthStatus; responseTimeMs?: number; error?: string }> {
    if (!this.sharedPool) {
      return { status: 'ok' };
    }

    let status: PoolHealthStatus = 'ok';
    let responseTimeMs: number | undefined;
    let error: string | undefined;

    const waitingRequests = this.sharedPool.waitingCount;
    if (waitingRequests > 0) {
      status = 'degraded';
    }

    if (ping) {
      const pingResult = await this.executePingQuery(this.sharedPool, pingTimeoutMs);
      responseTimeMs = pingResult.responseTimeMs;

      if (!pingResult.success) {
        status = 'unhealthy';
        error = pingResult.error;
      } else if (pingResult.responseTimeMs && pingResult.responseTimeMs > pingTimeoutMs / 2) {
        if (status === 'ok') {
          status = 'degraded';
        }
      }
    }

    return { status, responseTimeMs, error };
  }

  /**
   * Execute a ping query with timeout
   */
  private async executePingQuery(
    pool: Pool,
    timeoutMs: number
  ): Promise<{ success: boolean; responseTimeMs?: number; error?: string }> {
    const startTime = Date.now();

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check ping timeout')), timeoutMs);
      });

      const queryPromise = pool.query('SELECT 1');

      await Promise.race([queryPromise, timeoutPromise]);

      return {
        success: true,
        responseTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        responseTimeMs: Date.now() - startTime,
        error: (err as Error).message,
      };
    }
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
