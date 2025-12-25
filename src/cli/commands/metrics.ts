import { Command } from 'commander';
import { loadConfig } from '../utils/config.js';
import { createSpinner } from '../utils/spinner.js';
import { handleError } from '../utils/errors.js';
import {
  getOutputContext,
  outputJson,
  log,
  bold,
  dim,
  cyan,
  green,
  yellow,
  red,
} from '../utils/output.js';
import type { GlobalOptions } from '../types.js';
import type { MetricsJsonOutput } from '../../metrics/types.js';
import { PoolManager } from '../../pool.js';
import { MetricsCollector } from '../../metrics/collector.js';
import { PrometheusExporter } from '../../metrics/prometheus.js';

/**
 * Options for the metrics command
 */
interface MetricsOptions extends GlobalOptions {
  config?: string;
  health?: boolean;
  prometheus?: boolean;
  prefix?: string;
  watch?: boolean;
  interval?: string;
}

/**
 * Metrics command - display current pool and health metrics
 */
export const metricsCommand = new Command('metrics')
  .description('Display current pool and health metrics')
  .option('-c, --config <path>', 'Path to config file')
  .option('--health', 'Include health check (can be slow)', false)
  .option('--prometheus', 'Output in Prometheus text format')
  .option('--prefix <prefix>', 'Metric name prefix (default: drizzle_multitenant)')
  .option('-w, --watch', 'Watch mode - refresh metrics periodically', false)
  .option('-i, --interval <ms>', 'Refresh interval in ms (default: 5000)', '5000')
  .addHelpText(
    'after',
    `
Examples:
  $ drizzle-multitenant metrics
  $ drizzle-multitenant metrics --health
  $ drizzle-multitenant metrics --prometheus
  $ drizzle-multitenant metrics --json
  $ drizzle-multitenant metrics --watch --interval 3000
  $ drizzle-multitenant metrics --prometheus | curl -X POST --data-binary @- http://pushgateway:9091/metrics/job/drizzle
`
  )
  .action(async (options: MetricsOptions) => {
    const ctx = getOutputContext();
    const spinner = createSpinner('Loading configuration...');
    let manager: PoolManager<Record<string, unknown>, Record<string, unknown>> | null = null;

    try {
      spinner.start();

      // Load configuration
      const { config } = await loadConfig(options.config);

      // Create pool manager
      manager = new PoolManager(config);

      // Create metrics collector
      const collector = new MetricsCollector(manager);

      // Create Prometheus exporter if needed
      const exporter = options.prometheus
        ? new PrometheusExporter({ prefix: options.prefix })
        : null;

      spinner.succeed('Configuration loaded');

      // Watch mode
      if (options.watch && !ctx.jsonMode) {
        await runWatchMode(collector, exporter, options, () => manager?.dispose());
        return;
      }

      // Single collection
      const startTime = Date.now();
      spinner.text = 'Collecting metrics...';
      spinner.start();

      const metrics = await collector.collect({
        includeHealth: options.health,
      });
      const summary = collector.calculateSummary(metrics);
      const durationMs = Date.now() - startTime;

      spinner.succeed('Metrics collected');

      // Prometheus format output
      if (options.prometheus) {
        const runtime = collector.getRuntimeMetrics();
        const text = exporter!.export(metrics, runtime);
        process.stdout.write(text);
        return;
      }

      // JSON output
      if (ctx.jsonMode) {
        const jsonOutput: MetricsJsonOutput = {
          pools: {
            total: metrics.pools.pools.total,
            maxPools: metrics.pools.pools.maxPools,
            tenants: metrics.pools.pools.tenants.map((t) => ({
              tenantId: t.tenantId,
              schemaName: t.schemaName,
              connections: t.connections,
              lastAccessedAt: t.lastAccessedAt,
            })),
          },
          shared: {
            initialized: metrics.pools.shared.initialized,
            connections: metrics.pools.shared.connections,
          },
          health: metrics.health
            ? {
                healthy: metrics.health.healthy,
                totalPools: metrics.health.totalPools,
                degradedPools: metrics.health.degradedPools,
                unhealthyPools: metrics.health.unhealthyPools,
                sharedDbStatus: metrics.health.sharedDb,
                pools: metrics.health.pools.map((p) => ({
                  tenantId: p.tenantId,
                  status: p.status,
                  responseTimeMs: p.responseTimeMs,
                })),
              }
            : undefined,
          summary,
          timestamp: metrics.collectedAt,
          durationMs,
        };
        outputJson(jsonOutput);
        return;
      }

      // Human-readable output
      printMetrics(metrics, summary, durationMs, options.health ?? false);
    } catch (err) {
      spinner.fail((err as Error).message);
      handleError(err);
    } finally {
      // Cleanup pool manager
      if (manager && !options.watch) {
        await manager.dispose();
      }
    }
  });

/**
 * Print metrics in human-readable format
 */
function printMetrics(
  metrics: Awaited<ReturnType<MetricsCollector['collect']>>,
  summary: ReturnType<MetricsCollector['calculateSummary']>,
  durationMs: number,
  includeHealth: boolean
): void {
  log('\n' + bold(cyan('📊 drizzle-multitenant Metrics')) + '\n');

  // Pool summary
  log(bold('Pool Status:'));
  log(`  Active Pools: ${cyan(String(metrics.pools.pools.total))} / ${metrics.pools.pools.maxPools}`);
  log(`  Total Connections: ${summary.totalConnections}`);
  log(`  Idle Connections: ${green(String(summary.idleConnections))}`);
  log(`  Waiting Requests: ${summary.waitingRequests > 0 ? yellow(String(summary.waitingRequests)) : String(summary.waitingRequests)}`);

  // Shared pool
  log('\n' + bold('Shared Database:'));
  if (metrics.pools.shared.initialized) {
    const shared = metrics.pools.shared.connections!;
    log(`  Status: ${green('Initialized')}`);
    log(`  Connections: ${shared.total} total, ${shared.idle} idle, ${shared.waiting} waiting`);
  } else {
    log(`  Status: ${dim('Not initialized')}`);
  }

  // Health status (if included)
  if (includeHealth && metrics.health) {
    log('\n' + bold('Health Status:'));
    const healthIcon = metrics.health.healthy ? green('✓') : red('✗');
    log(`  Overall: ${healthIcon} ${metrics.health.healthy ? 'Healthy' : 'Unhealthy'}`);
    log(`  Pools: ${green(String(summary.healthyPools))} healthy, ${yellow(String(summary.degradedPools))} degraded, ${red(String(summary.unhealthyPools))} unhealthy`);
    log(`  Shared DB: ${getStatusColor(metrics.health.sharedDb)(metrics.health.sharedDb)}`);
    if (metrics.health.sharedDbResponseTimeMs !== undefined) {
      log(`  Shared DB Latency: ${metrics.health.sharedDbResponseTimeMs}ms`);
    }
    log(`  Check Duration: ${metrics.health.durationMs}ms`);
  }

  // Per-tenant details (if not too many)
  const tenants = metrics.pools.pools.tenants;
  if (tenants.length > 0 && tenants.length <= 20) {
    log('\n' + bold('Active Tenants:'));

    for (const tenant of tenants) {
      const healthInfo = includeHealth && metrics.health
        ? metrics.health.pools.find((p) => p.tenantId === tenant.tenantId)
        : null;

      const statusIcon = healthInfo
        ? getStatusIcon(healthInfo.status)
        : dim('○');

      const waitingColor = tenant.connections.waiting > 0 ? yellow : (x: string) => x;

      log(
        `  ${statusIcon} ${cyan(tenant.tenantId)}: ` +
        `${tenant.connections.total} conn, ` +
        `${tenant.connections.idle} idle, ` +
        `${waitingColor(String(tenant.connections.waiting))} waiting` +
        (healthInfo?.responseTimeMs ? dim(` (${healthInfo.responseTimeMs}ms)`) : '')
      );
    }
  } else if (tenants.length > 20) {
    log('\n' + dim(`(${tenants.length} active tenants - use --json for full list)`));
  }

  // Footer
  log('\n' + dim(`Collected at ${metrics.collectedAt} (${durationMs}ms)`));
  if (!includeHealth) {
    log(dim('Tip: Use --health to include health checks'));
  }
}

/**
 * Run in watch mode with periodic refresh
 */
async function runWatchMode(
  collector: MetricsCollector,
  exporter: PrometheusExporter | null,
  options: MetricsOptions,
  cleanup: () => Promise<void> | void
): Promise<void> {
  const interval = parseInt(options.interval ?? '5000', 10);

  log(bold(cyan('\n📊 Metrics Watch Mode')) + dim(` (refresh every ${interval}ms, Ctrl+C to exit)\n`));

  const refresh = async () => {
    const startTime = Date.now();
    const metrics = await collector.collect({ includeHealth: options.health });
    const summary = collector.calculateSummary(metrics);
    const durationMs = Date.now() - startTime;

    // Clear screen
    process.stdout.write('\x1B[2J\x1B[0f');

    if (exporter) {
      const runtime = collector.getRuntimeMetrics();
      process.stdout.write(exporter.export(metrics, runtime));
    } else {
      printMetrics(metrics, summary, durationMs, options.health ?? false);
    }
  };

  // Initial refresh
  await refresh();

  // Set up interval
  const intervalId = setInterval(refresh, interval);

  // Handle graceful shutdown
  const shutdown = async () => {
    clearInterval(intervalId);
    log('\n' + dim('Stopping watch mode...'));
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive
  await new Promise(() => {});
}

/**
 * Get status icon
 */
function getStatusIcon(status: 'ok' | 'degraded' | 'unhealthy'): string {
  switch (status) {
    case 'ok':
      return green('●');
    case 'degraded':
      return yellow('◐');
    case 'unhealthy':
      return red('○');
  }
}

/**
 * Get status color function
 */
function getStatusColor(status: 'ok' | 'degraded' | 'unhealthy'): (text: string) => string {
  switch (status) {
    case 'ok':
      return green;
    case 'degraded':
      return yellow;
    case 'unhealthy':
      return red;
  }
}
