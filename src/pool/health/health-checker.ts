import type { Pool } from 'pg';
import type {
  PoolEntry,
  HealthCheckOptions,
  HealthCheckResult,
  PoolHealth,
  PoolHealthStatus,
} from '../../types.js';

/**
 * Ping query result
 */
export interface PingResult {
  success: boolean;
  responseTimeMs?: number;
  error?: string;
}

/**
 * Shared database health result
 */
export interface SharedDbHealthResult {
  status: PoolHealthStatus;
  responseTimeMs?: number;
  error?: string;
}

/**
 * Pool info for health checking
 */
export interface PoolInfo<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  schemaName: string;
  tenantId: string;
  entry: PoolEntry<TSchema>;
}

/**
 * Dependencies for HealthChecker
 */
export interface HealthCheckerDeps<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /** Function to get all pool entries */
  getPoolEntries: () => Iterable<[string, PoolEntry<TSchema>]>;
  /** Function to get tenantId from schemaName */
  getTenantIdBySchema: (schemaName: string) => string | undefined;
  /** Function to get pool entry by schemaName */
  getPoolEntry: (schemaName: string) => PoolEntry<TSchema> | undefined;
  /** Function to get schema name from tenantId */
  getSchemaName: (tenantId: string) => string;
  /** Function to get shared pool (may be null if not initialized) */
  getSharedPool: () => Pool | null;
}

/**
 * Health checker for database pools
 *
 * Responsible for checking the health of tenant pools and shared database.
 * Extracted from PoolManager as part of the refactoring effort.
 *
 * @example
 * ```typescript
 * const healthChecker = new HealthChecker({
 *   getPoolEntries: () => poolCache.entries(),
 *   getTenantIdBySchema: (schema) => tenantMap.get(schema),
 *   getPoolEntry: (schema) => poolCache.get(schema),
 *   getSchemaName: (tenantId) => `tenant_${tenantId}`,
 *   getSharedPool: () => sharedPool,
 * });
 *
 * const result = await healthChecker.checkHealth({ ping: true });
 * console.log(result.healthy); // true/false
 * ```
 */
export class HealthChecker<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  constructor(private readonly deps: HealthCheckerDeps<TSchema>) {}

  /**
   * Check health of all pools and connections
   *
   * Verifies the health of tenant pools and optionally the shared database.
   * Returns detailed status information for monitoring and load balancer integration.
   *
   * @example
   * ```typescript
   * // Basic health check
   * const health = await healthChecker.checkHealth();
   * console.log(health.healthy); // true/false
   *
   * // Check specific tenants only
   * const health = await healthChecker.checkHealth({
   *   tenantIds: ['tenant-1', 'tenant-2'],
   *   ping: true,
   *   pingTimeoutMs: 3000,
   * });
   * ```
   */
  async checkHealth(options: HealthCheckOptions = {}): Promise<HealthCheckResult> {
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
    const poolsToCheck = this.getPoolsToCheck(tenantIds);

    // Check tenant pools in parallel
    const poolChecks = poolsToCheck.map(async ({ schemaName, tenantId, entry }) => {
      return this.checkPoolHealth(tenantId, schemaName, entry, ping, pingTimeoutMs);
    });

    poolHealthResults.push(...(await Promise.all(poolChecks)));

    // Check shared database
    const sharedPool = this.deps.getSharedPool();
    if (includeShared && sharedPool) {
      const sharedResult = await this.checkSharedDbHealth(sharedPool, ping, pingTimeoutMs);
      sharedDbStatus = sharedResult.status;
      sharedDbResponseTimeMs = sharedResult.responseTimeMs;
      sharedDbError = sharedResult.error;
    }

    // Calculate aggregate stats
    const degradedPools = poolHealthResults.filter((p) => p.status === 'degraded').length;
    const unhealthyPools = poolHealthResults.filter((p) => p.status === 'unhealthy').length;

    // Overall health: healthy if no unhealthy pools and shared db is ok
    const healthy = unhealthyPools === 0 && sharedDbStatus !== 'unhealthy';

    const result: HealthCheckResult = {
      healthy,
      pools: poolHealthResults,
      sharedDb: sharedDbStatus,
      totalPools: poolHealthResults.length,
      degradedPools,
      unhealthyPools,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    // Only add optional properties if they have values
    if (sharedDbResponseTimeMs !== undefined) {
      result.sharedDbResponseTimeMs = sharedDbResponseTimeMs;
    }
    if (sharedDbError !== undefined) {
      result.sharedDbError = sharedDbError;
    }

    return result;
  }

  /**
   * Get pools to check based on options
   */
  private getPoolsToCheck(tenantIds?: string[]): PoolInfo<TSchema>[] {
    const poolsToCheck: PoolInfo<TSchema>[] = [];

    if (tenantIds && tenantIds.length > 0) {
      // Check only specified tenants
      for (const tenantId of tenantIds) {
        const schemaName = this.deps.getSchemaName(tenantId);
        const entry = this.deps.getPoolEntry(schemaName);
        if (entry) {
          poolsToCheck.push({ schemaName, tenantId, entry });
        }
      }
    } else {
      // Check all active pools
      for (const [schemaName, entry] of this.deps.getPoolEntries()) {
        const tenantId = this.deps.getTenantIdBySchema(schemaName) ?? schemaName;
        poolsToCheck.push({ schemaName, tenantId, entry });
      }
    }

    return poolsToCheck;
  }

  /**
   * Check health of a single tenant pool
   */
  async checkPoolHealth(
    tenantId: string,
    schemaName: string,
    entry: PoolEntry<TSchema>,
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

    const result: PoolHealth = {
      tenantId,
      schemaName,
      status,
      totalConnections,
      idleConnections,
      waitingRequests,
    };

    // Only add optional properties if they have values
    if (responseTimeMs !== undefined) {
      result.responseTimeMs = responseTimeMs;
    }
    if (error !== undefined) {
      result.error = error;
    }

    return result;
  }

  /**
   * Check health of shared database
   */
  async checkSharedDbHealth(
    sharedPool: Pool,
    ping: boolean,
    pingTimeoutMs: number
  ): Promise<SharedDbHealthResult> {
    let status: PoolHealthStatus = 'ok';
    let responseTimeMs: number | undefined;
    let error: string | undefined;

    const waitingRequests = sharedPool.waitingCount;
    if (waitingRequests > 0) {
      status = 'degraded';
    }

    if (ping) {
      const pingResult = await this.executePingQuery(sharedPool, pingTimeoutMs);
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

    const result: SharedDbHealthResult = { status };

    // Only add optional properties if they have values
    if (responseTimeMs !== undefined) {
      result.responseTimeMs = responseTimeMs;
    }
    if (error !== undefined) {
      result.error = error;
    }

    return result;
  }

  /**
   * Execute a ping query with timeout
   */
  async executePingQuery(pool: Pool, timeoutMs: number): Promise<PingResult> {
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
   * Determine overall health status from pool health results
   */
  determineOverallHealth(pools: PoolHealth[], sharedDbStatus: PoolHealthStatus = 'ok'): boolean {
    const unhealthyPools = pools.filter((p) => p.status === 'unhealthy').length;
    return unhealthyPools === 0 && sharedDbStatus !== 'unhealthy';
  }
}
