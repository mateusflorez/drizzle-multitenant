/**
 * Metrics collector that aggregates data from all sources
 * @module drizzle-multitenant/metrics
 */

import type { TenantManager, MetricsResult, HealthCheckResult } from '../types.js';
import type {
  AggregatedMetrics,
  MetricsCollectorOptions,
  RuntimeMetrics,
} from './types.js';

/**
 * Collects and aggregates metrics from pool manager and other sources
 *
 * @example
 * ```typescript
 * import { MetricsCollector } from 'drizzle-multitenant/metrics';
 *
 * const collector = new MetricsCollector(tenantManager);
 *
 * // Quick collection (no health check)
 * const metrics = await collector.collect();
 *
 * // With health check
 * const fullMetrics = await collector.collect({ includeHealth: true });
 * ```
 */
export class MetricsCollector<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(
    private readonly tenantManager: TenantManager<TTenantSchema, TSharedSchema>
  ) {}

  /**
   * Collect metrics from all sources
   *
   * @param options - Collection options
   * @returns Aggregated metrics from all sources
   *
   * @example
   * ```typescript
   * // Quick collection
   * const metrics = await collector.collect();
   *
   * // With health check (can be slow for many tenants)
   * const metrics = await collector.collect({ includeHealth: true });
   *
   * // Check specific tenants only
   * const metrics = await collector.collect({
   *   includeHealth: true,
   *   tenantIds: ['tenant-1', 'tenant-2'],
   * });
   * ```
   */
  async collect(options: MetricsCollectorOptions = {}): Promise<AggregatedMetrics> {
    const { includeHealth = false, healthPingTimeoutMs = 5000, tenantIds } = options;

    // Get pool metrics (always fast, on-demand)
    const pools = this.tenantManager.getMetrics();

    // Optionally get health check (can be slow)
    let health: HealthCheckResult | undefined;
    if (includeHealth) {
      health = await this.tenantManager.healthCheck({
        ping: true,
        pingTimeoutMs: healthPingTimeoutMs,
        includeShared: true,
        ...(tenantIds && { tenantIds }),
      });
    }

    return {
      pools,
      health,
      collectedAt: new Date().toISOString(),
    };
  }

  /**
   * Get pool metrics only (synchronous, zero overhead)
   *
   * @returns Pool metrics
   */
  getPoolMetrics(): MetricsResult {
    return this.tenantManager.getMetrics();
  }

  /**
   * Get health check results
   *
   * @param options - Health check options
   * @returns Health check results
   */
  async getHealthMetrics(options?: {
    pingTimeoutMs?: number;
    tenantIds?: string[];
  }): Promise<HealthCheckResult> {
    return this.tenantManager.healthCheck({
      ping: true,
      pingTimeoutMs: options?.pingTimeoutMs ?? 5000,
      includeShared: true,
      ...(options?.tenantIds && { tenantIds: options.tenantIds }),
    });
  }

  /**
   * Get Node.js runtime metrics
   *
   * @returns Runtime metrics (memory, uptime, etc.)
   */
  getRuntimeMetrics(): RuntimeMetrics {
    const memoryUsage = process.memoryUsage();

    return {
      uptimeSeconds: process.uptime(),
      memoryUsage: {
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
      activeHandles: (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })
        ._getActiveHandles?.()?.length ?? 0,
      activeRequests: (process as NodeJS.Process & { _getActiveRequests?: () => unknown[] })
        ._getActiveRequests?.()?.length ?? 0,
    };
  }

  /**
   * Calculate summary statistics from metrics
   *
   * @param metrics - Aggregated metrics
   * @returns Summary statistics
   */
  calculateSummary(metrics: AggregatedMetrics): {
    activePools: number;
    totalConnections: number;
    idleConnections: number;
    waitingRequests: number;
    healthyPools: number;
    degradedPools: number;
    unhealthyPools: number;
  } {
    const pools = metrics.pools;
    const health = metrics.health;

    // Calculate connection totals from pool metrics
    let totalConnections = 0;
    let idleConnections = 0;
    let waitingRequests = 0;

    for (const tenant of pools.pools.tenants) {
      totalConnections += tenant.connections.total;
      idleConnections += tenant.connections.idle;
      waitingRequests += tenant.connections.waiting;
    }

    // Add shared pool if initialized
    if (pools.shared.connections) {
      totalConnections += pools.shared.connections.total;
      idleConnections += pools.shared.connections.idle;
      waitingRequests += pools.shared.connections.waiting;
    }

    // Get health status counts
    const healthyPools = health
      ? health.pools.filter((p) => p.status === 'ok').length
      : pools.pools.total;
    const degradedPools = health?.degradedPools ?? 0;
    const unhealthyPools = health?.unhealthyPools ?? 0;

    return {
      activePools: pools.pools.total,
      totalConnections,
      idleConnections,
      waitingRequests,
      healthyPools,
      degradedPools,
      unhealthyPools,
    };
  }
}

/**
 * Create a metrics collector instance
 *
 * @param tenantManager - The tenant manager to collect metrics from
 * @returns A new MetricsCollector instance
 *
 * @example
 * ```typescript
 * import { createMetricsCollector } from 'drizzle-multitenant/metrics';
 *
 * const collector = createMetricsCollector(tenantManager);
 * const metrics = await collector.collect({ includeHealth: true });
 * ```
 */
export function createMetricsCollector<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  tenantManager: TenantManager<TTenantSchema, TSharedSchema>
): MetricsCollector<TTenantSchema, TSharedSchema> {
  return new MetricsCollector(tenantManager);
}
