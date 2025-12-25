/**
 * Prometheus metrics exporter
 * @module drizzle-multitenant/metrics
 *
 * Exports metrics in Prometheus text exposition format.
 * Compatible with Prometheus, Grafana, and other monitoring tools.
 */

import type {
  AggregatedMetrics,
  PrometheusExporterOptions,
  PrometheusMetric,
  PrometheusMetricValue,
  MetricDefinition,
  RuntimeMetrics,
} from './types.js';

/**
 * Default metric prefix
 */
const DEFAULT_PREFIX = 'drizzle_multitenant';

/**
 * Registry of all metric definitions
 */
const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Pool metrics
  {
    name: 'pools_active',
    help: 'Number of active database pools',
    type: 'gauge',
    extract: (m) => [{ value: m.pools.pools.total }],
  },
  {
    name: 'pools_max',
    help: 'Maximum number of pools allowed',
    type: 'gauge',
    extract: (m) => [{ value: m.pools.pools.maxPools }],
  },
  {
    name: 'pool_connections_total',
    help: 'Total connections in pool',
    type: 'gauge',
    labels: ['tenant', 'schema'],
    extract: (m) =>
      m.pools.pools.tenants.map((t) => ({
        labels: { tenant: t.tenantId, schema: t.schemaName },
        value: t.connections.total,
      })),
  },
  {
    name: 'pool_connections_idle',
    help: 'Idle connections in pool',
    type: 'gauge',
    labels: ['tenant', 'schema'],
    extract: (m) =>
      m.pools.pools.tenants.map((t) => ({
        labels: { tenant: t.tenantId, schema: t.schemaName },
        value: t.connections.idle,
      })),
  },
  {
    name: 'pool_connections_waiting',
    help: 'Waiting requests in pool queue',
    type: 'gauge',
    labels: ['tenant', 'schema'],
    extract: (m) =>
      m.pools.pools.tenants.map((t) => ({
        labels: { tenant: t.tenantId, schema: t.schemaName },
        value: t.connections.waiting,
      })),
  },
  {
    name: 'pool_last_access_timestamp',
    help: 'Last access timestamp for pool (unix epoch)',
    type: 'gauge',
    labels: ['tenant', 'schema'],
    extract: (m) =>
      m.pools.pools.tenants.map((t) => ({
        labels: { tenant: t.tenantId, schema: t.schemaName },
        value: new Date(t.lastAccessedAt).getTime() / 1000,
      })),
  },

  // Shared pool metrics
  {
    name: 'shared_pool_initialized',
    help: 'Whether shared database pool is initialized (1=yes, 0=no)',
    type: 'gauge',
    extract: (m) => [{ value: m.pools.shared.initialized ? 1 : 0 }],
  },
  {
    name: 'shared_pool_connections_total',
    help: 'Total connections in shared pool',
    type: 'gauge',
    extract: (m) => [{ value: m.pools.shared.connections?.total ?? 0 }],
  },
  {
    name: 'shared_pool_connections_idle',
    help: 'Idle connections in shared pool',
    type: 'gauge',
    extract: (m) => [{ value: m.pools.shared.connections?.idle ?? 0 }],
  },
  {
    name: 'shared_pool_connections_waiting',
    help: 'Waiting requests in shared pool queue',
    type: 'gauge',
    extract: (m) => [{ value: m.pools.shared.connections?.waiting ?? 0 }],
  },

  // Health metrics (only if health check was performed)
  {
    name: 'health_status',
    help: 'Overall health status (1=healthy, 0=unhealthy)',
    type: 'gauge',
    extract: (m) => (m.health ? [{ value: m.health.healthy ? 1 : 0 }] : []),
  },
  {
    name: 'health_pools_total',
    help: 'Total number of pools checked',
    type: 'gauge',
    extract: (m) => (m.health ? [{ value: m.health.totalPools }] : []),
  },
  {
    name: 'health_pools_degraded',
    help: 'Number of degraded pools',
    type: 'gauge',
    extract: (m) => (m.health ? [{ value: m.health.degradedPools }] : []),
  },
  {
    name: 'health_pools_unhealthy',
    help: 'Number of unhealthy pools',
    type: 'gauge',
    extract: (m) => (m.health ? [{ value: m.health.unhealthyPools }] : []),
  },
  {
    name: 'health_check_duration_seconds',
    help: 'Duration of health check in seconds',
    type: 'gauge',
    extract: (m) => (m.health ? [{ value: m.health.durationMs / 1000 }] : []),
  },
  {
    name: 'pool_health_status',
    help: 'Health status per pool (1=ok, 0.5=degraded, 0=unhealthy)',
    type: 'gauge',
    labels: ['tenant', 'schema', 'status'],
    extract: (m) =>
      m.health?.pools.map((p) => ({
        labels: { tenant: p.tenantId, schema: p.schemaName, status: p.status },
        value: p.status === 'ok' ? 1 : p.status === 'degraded' ? 0.5 : 0,
      })) ?? [],
  },
  {
    name: 'pool_response_time_seconds',
    help: 'Pool ping response time in seconds',
    type: 'gauge',
    labels: ['tenant', 'schema'],
    extract: (m) =>
      m.health?.pools
        .filter((p) => p.responseTimeMs !== undefined)
        .map((p) => ({
          labels: { tenant: p.tenantId, schema: p.schemaName },
          value: (p.responseTimeMs ?? 0) / 1000,
        })) ?? [],
  },
  {
    name: 'shared_db_health_status',
    help: 'Shared database health status (1=ok, 0.5=degraded, 0=unhealthy)',
    type: 'gauge',
    extract: (m) => {
      if (!m.health) return [];
      const status = m.health.sharedDb;
      return [{ value: status === 'ok' ? 1 : status === 'degraded' ? 0.5 : 0 }];
    },
  },
  {
    name: 'shared_db_response_time_seconds',
    help: 'Shared database ping response time in seconds',
    type: 'gauge',
    extract: (m) =>
      m.health?.sharedDbResponseTimeMs !== undefined
        ? [{ value: m.health.sharedDbResponseTimeMs / 1000 }]
        : [],
  },
];

/**
 * Runtime metrics definitions
 */
const RUNTIME_DEFINITIONS: Array<{
  name: string;
  help: string;
  type: 'gauge';
  extract: (r: RuntimeMetrics) => PrometheusMetricValue[];
}> = [
  {
    name: 'process_uptime_seconds',
    help: 'Process uptime in seconds',
    type: 'gauge',
    extract: (r) => [{ value: r.uptimeSeconds }],
  },
  {
    name: 'process_heap_bytes_total',
    help: 'Total heap memory in bytes',
    type: 'gauge',
    extract: (r) => [{ value: r.memoryUsage.heapTotal }],
  },
  {
    name: 'process_heap_bytes_used',
    help: 'Used heap memory in bytes',
    type: 'gauge',
    extract: (r) => [{ value: r.memoryUsage.heapUsed }],
  },
  {
    name: 'process_external_bytes',
    help: 'External memory in bytes',
    type: 'gauge',
    extract: (r) => [{ value: r.memoryUsage.external }],
  },
  {
    name: 'process_rss_bytes',
    help: 'Resident Set Size in bytes',
    type: 'gauge',
    extract: (r) => [{ value: r.memoryUsage.rss }],
  },
  {
    name: 'process_active_handles',
    help: 'Number of active handles',
    type: 'gauge',
    extract: (r) => [{ value: r.activeHandles }],
  },
  {
    name: 'process_active_requests',
    help: 'Number of active requests',
    type: 'gauge',
    extract: (r) => [{ value: r.activeRequests }],
  },
];

/**
 * Prometheus metrics exporter
 *
 * Converts aggregated metrics to Prometheus text exposition format.
 *
 * @example
 * ```typescript
 * import { PrometheusExporter, createMetricsCollector } from 'drizzle-multitenant/metrics';
 *
 * const collector = createMetricsCollector(tenantManager);
 * const exporter = new PrometheusExporter({ prefix: 'myapp' });
 *
 * // Get metrics
 * const metrics = await collector.collect({ includeHealth: true });
 *
 * // Export as Prometheus text format
 * const text = exporter.export(metrics);
 *
 * // Use in Express endpoint
 * app.get('/metrics', async (req, res) => {
 *   const metrics = await collector.collect({ includeHealth: true });
 *   res.set('Content-Type', 'text/plain; version=0.0.4');
 *   res.send(exporter.export(metrics));
 * });
 * ```
 */
export class PrometheusExporter {
  private readonly prefix: string;
  private readonly includeTenantLabels: boolean;
  private readonly includeTimestamps: boolean;
  private readonly defaultLabels: Record<string, string>;

  constructor(options: PrometheusExporterOptions = {}) {
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.includeTenantLabels = options.includeTenantLabels ?? true;
    this.includeTimestamps = options.includeTimestamps ?? false;
    this.defaultLabels = options.defaultLabels ?? {};
  }

  /**
   * Export aggregated metrics to Prometheus text format
   *
   * @param metrics - Aggregated metrics from collector
   * @param runtime - Optional runtime metrics
   * @returns Prometheus text exposition format string
   */
  export(metrics: AggregatedMetrics, runtime?: RuntimeMetrics): string {
    const prometheusMetrics = this.toPrometheusMetrics(metrics);
    const lines: string[] = [];

    for (const metric of prometheusMetrics) {
      lines.push(...this.formatMetric(metric));
    }

    // Add runtime metrics if provided
    if (runtime) {
      const runtimeMetrics = this.extractRuntimeMetrics(runtime);
      for (const metric of runtimeMetrics) {
        lines.push(...this.formatMetric(metric));
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Convert aggregated metrics to Prometheus metric objects
   */
  toPrometheusMetrics(metrics: AggregatedMetrics): PrometheusMetric[] {
    const result: PrometheusMetric[] = [];

    for (const definition of METRIC_DEFINITIONS) {
      const values = definition.extract(metrics);

      // Skip metrics with no values
      if (values.length === 0) continue;

      // Filter out tenant labels if disabled
      const filteredValues = this.includeTenantLabels
        ? values
        : values.map((v) => {
            if (!v.labels) return v;
            const { tenant, schema, ...rest } = v.labels;
            return { ...v, labels: Object.keys(rest).length > 0 ? rest : undefined };
          });

      // Add default labels
      const finalValues = filteredValues.map((v) => ({
        ...v,
        labels: { ...this.defaultLabels, ...v.labels },
      }));

      result.push({
        name: `${this.prefix}_${definition.name}`,
        help: definition.help,
        type: definition.type,
        labels: definition.labels,
        values: finalValues,
      });
    }

    return result;
  }

  /**
   * Extract runtime metrics
   */
  private extractRuntimeMetrics(runtime: RuntimeMetrics): PrometheusMetric[] {
    const result: PrometheusMetric[] = [];

    for (const definition of RUNTIME_DEFINITIONS) {
      const values = definition.extract(runtime);

      if (values.length === 0) continue;

      // Add default labels
      const finalValues = values.map((v) => ({
        ...v,
        labels: { ...this.defaultLabels, ...v.labels },
      }));

      result.push({
        name: `${this.prefix}_${definition.name}`,
        help: definition.help,
        type: definition.type,
        values: finalValues,
      });
    }

    return result;
  }

  /**
   * Format a single metric in Prometheus text format
   */
  private formatMetric(metric: PrometheusMetric): string[] {
    const lines: string[] = [];

    // HELP line
    lines.push(`# HELP ${metric.name} ${metric.help}`);

    // TYPE line
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    // Value lines
    for (const value of metric.values) {
      const labelStr = this.formatLabels(value.labels);
      const timestamp = this.includeTimestamps && value.timestamp ? ` ${value.timestamp}` : '';
      lines.push(`${metric.name}${labelStr} ${value.value}${timestamp}`);
    }

    return lines;
  }

  /**
   * Format labels for Prometheus
   */
  private formatLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }

    const pairs = Object.entries(labels)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}="${this.escapeLabel(v)}"`);

    return `{${pairs.join(',')}}`;
  }

  /**
   * Escape label values for Prometheus
   */
  private escapeLabel(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }

  /**
   * Get the content type header for Prometheus
   */
  static get contentType(): string {
    return 'text/plain; version=0.0.4; charset=utf-8';
  }
}

/**
 * Create a Prometheus exporter instance
 *
 * @param options - Exporter options
 * @returns A new PrometheusExporter instance
 *
 * @example
 * ```typescript
 * import { createPrometheusExporter } from 'drizzle-multitenant/metrics';
 *
 * const exporter = createPrometheusExporter({
 *   prefix: 'myapp',
 *   defaultLabels: { env: 'production' },
 * });
 * ```
 */
export function createPrometheusExporter(
  options?: PrometheusExporterOptions
): PrometheusExporter {
  return new PrometheusExporter(options);
}
