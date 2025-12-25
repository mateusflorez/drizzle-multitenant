/**
 * Metrics module types
 * @module drizzle-multitenant/metrics
 */

import type { MetricsResult, HealthCheckResult } from '../types.js';

/**
 * Prometheus metric types
 */
export type PrometheusMetricType = 'gauge' | 'counter' | 'histogram' | 'summary';

/**
 * A single Prometheus metric definition
 */
export interface PrometheusMetric {
  /** Metric name (e.g., drizzle_pool_connections_total) */
  name: string;
  /** Metric help description */
  help: string;
  /** Metric type */
  type: PrometheusMetricType;
  /** Label names */
  labels?: string[] | undefined;
  /** Values with label sets */
  values: PrometheusMetricValue[];
}

/**
 * A metric value with optional labels
 */
export interface PrometheusMetricValue {
  /** Label values (in same order as labels array) */
  labels?: Record<string, string>;
  /** Metric value */
  value: number;
  /** Optional timestamp in milliseconds */
  timestamp?: number;
}

/**
 * Options for the Prometheus exporter
 */
export interface PrometheusExporterOptions {
  /** Prefix for all metric names (default: drizzle_multitenant) */
  prefix?: string | undefined;
  /** Include tenant labels (default: true) */
  includeTenantLabels?: boolean | undefined;
  /** Include timestamps in output (default: false) */
  includeTimestamps?: boolean | undefined;
  /** Custom labels to add to all metrics */
  defaultLabels?: Record<string, string> | undefined;
}

/**
 * Aggregated metrics from all sources
 */
export interface AggregatedMetrics {
  /** Pool manager metrics */
  pools: MetricsResult;
  /** Health check results (optional) */
  health?: HealthCheckResult | undefined;
  /** Migration metrics (optional) */
  migrations?: MigrationMetrics | undefined;
  /** Timestamp of collection */
  collectedAt: string;
}

/**
 * Migration metrics for monitoring
 */
export interface MigrationMetrics {
  /** Total tenants */
  totalTenants: number;
  /** Tenants with pending migrations */
  tenantsWithPending: number;
  /** Total pending migrations across all tenants */
  totalPendingMigrations: number;
  /** Total applied migrations across all tenants */
  totalAppliedMigrations: number;
  /** Tenants in error state */
  tenantsInError: number;
  /** Last migration timestamp */
  lastMigrationAt?: string;
  /** Per-tenant migration status */
  perTenant?: TenantMigrationMetric[];
}

/**
 * Per-tenant migration metrics
 */
export interface TenantMigrationMetric {
  /** Tenant ID */
  tenantId: string;
  /** Number of applied migrations */
  appliedCount: number;
  /** Number of pending migrations */
  pendingCount: number;
  /** Migration status */
  status: 'ok' | 'behind' | 'error';
}

/**
 * Metric definitions registry
 */
export interface MetricDefinition {
  /** Metric name (without prefix) */
  name: string;
  /** Help description */
  help: string;
  /** Metric type */
  type: PrometheusMetricType;
  /** Label names */
  labels?: string[];
  /** Extractor function to get values from aggregated metrics */
  extract: (metrics: AggregatedMetrics) => PrometheusMetricValue[];
}

/**
 * JSON output for metrics CLI command
 */
export interface MetricsJsonOutput {
  /** Pool metrics */
  pools: {
    total: number;
    maxPools: number;
    tenants: Array<{
      tenantId: string;
      schemaName: string;
      connections: {
        total: number;
        idle: number;
        waiting: number;
      };
      lastAccessedAt: string;
    }>;
  };
  /** Shared database metrics */
  shared: {
    initialized: boolean;
    connections: {
      total: number;
      idle: number;
      waiting: number;
    } | null;
  };
  /** Health status */
  health?: {
    healthy: boolean;
    totalPools: number;
    degradedPools: number;
    unhealthyPools: number;
    sharedDbStatus: string;
    pools: Array<{
      tenantId: string;
      status: string;
      responseTimeMs?: number;
    }>;
  };
  /** Summary statistics */
  summary: {
    activePools: number;
    totalConnections: number;
    idleConnections: number;
    waitingRequests: number;
    healthyPools: number;
    degradedPools: number;
    unhealthyPools: number;
  };
  /** Collection timestamp */
  timestamp: string;
  /** Collection duration */
  durationMs: number;
}

/**
 * Options for metrics collection
 */
export interface MetricsCollectorOptions {
  /** Include health check (default: false, can be slow) */
  includeHealth?: boolean;
  /** Health check ping timeout in ms (default: 5000) */
  healthPingTimeoutMs?: number;
  /** Include migration status (requires migrator) */
  includeMigrations?: boolean;
  /** Specific tenant IDs to check */
  tenantIds?: string[];
}

/**
 * Framework integration options
 */
export interface MetricsEndpointOptions extends PrometheusExporterOptions {
  /** Endpoint path (default: /metrics) */
  path?: string;
  /** Enable basic auth */
  auth?: {
    username: string;
    password: string;
  };
  /** Include runtime metrics (Node.js memory, CPU, etc.) */
  includeRuntime?: boolean;
}

/**
 * Runtime metrics for Node.js process
 */
export interface RuntimeMetrics {
  /** Process uptime in seconds */
  uptimeSeconds: number;
  /** Memory usage in bytes */
  memoryUsage: {
    heapTotal: number;
    heapUsed: number;
    external: number;
    rss: number;
  };
  /** Event loop lag in milliseconds (if available) */
  eventLoopLag?: number;
  /** Active handles count */
  activeHandles: number;
  /** Active requests count */
  activeRequests: number;
}
