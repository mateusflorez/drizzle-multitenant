/**
 * Metrics module for drizzle-multitenant
 *
 * Provides Prometheus-compatible metrics collection and export.
 *
 * @module drizzle-multitenant/metrics
 *
 * @example
 * ```typescript
 * import { createMetricsCollector, createPrometheusExporter } from 'drizzle-multitenant/metrics';
 *
 * // Create collector and exporter
 * const collector = createMetricsCollector(tenantManager);
 * const exporter = createPrometheusExporter({ prefix: 'myapp' });
 *
 * // Collect and export metrics
 * const metrics = await collector.collect({ includeHealth: true });
 * const prometheusText = exporter.export(metrics);
 * ```
 */

// Types
export type {
  PrometheusMetricType,
  PrometheusMetric,
  PrometheusMetricValue,
  PrometheusExporterOptions,
  AggregatedMetrics,
  MigrationMetrics,
  TenantMigrationMetric,
  MetricDefinition,
  MetricsJsonOutput,
  MetricsCollectorOptions,
  MetricsEndpointOptions,
  RuntimeMetrics,
} from './types.js';

// Collector
export { MetricsCollector, createMetricsCollector } from './collector.js';

// Prometheus exporter
export { PrometheusExporter, createPrometheusExporter } from './prometheus.js';

// Express integration
export { createMetricsMiddleware, createMetricsHandler } from './express.js';

// Fastify integration
export {
  fastifyMetricsPlugin,
  createFastifyMetricsHandler,
  type FastifyMetricsPluginOptions,
} from './fastify.js';
