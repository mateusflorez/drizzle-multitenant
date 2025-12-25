import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { MenuRenderer } from '../base/menu-renderer.js';
import { PoolManager } from '../../../pool.js';
import { MetricsCollector } from '../../../metrics/collector.js';
import { PrometheusExporter } from '../../../metrics/prometheus.js';
import type { MenuContext, ScreenAction } from '../types.js';
import type { AggregatedMetrics } from '../../../metrics/types.js';

/**
 * Screen for viewing pool and health metrics
 */
export class MetricsScreen {
  private readonly renderer: MenuRenderer;
  private readonly ctx: MenuContext;
  private manager: PoolManager<Record<string, unknown>, Record<string, unknown>> | null = null;
  private collector: MetricsCollector | null = null;

  constructor(ctx: MenuContext, renderer?: MenuRenderer) {
    this.ctx = ctx;
    this.renderer = renderer || new MenuRenderer();
  }

  /**
   * Show the metrics screen
   */
  async show(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Metrics Dashboard');

    const action = await select({
      message: 'What would you like to view?',
      choices: [
        { name: 'Pool metrics (fast)', value: 'pools' },
        { name: 'Health check (includes ping)', value: 'health' },
        { name: 'Prometheus export', value: 'prometheus' },
        { name: 'Runtime metrics', value: 'runtime' },
        { name: chalk.gray('← Back to main menu'), value: 'back' },
      ],
    });

    switch (action) {
      case 'pools':
        return this.showPoolMetrics();
      case 'health':
        return this.showHealthMetrics();
      case 'prometheus':
        return this.showPrometheusExport();
      case 'runtime':
        return this.showRuntimeMetrics();
      default:
        return { type: 'back' };
    }
  }

  /**
   * Initialize pool manager and collector
   */
  private async ensureInitialized(): Promise<boolean> {
    if (this.collector) return true;

    try {
      this.manager = new PoolManager(this.ctx.config);
      this.collector = new MetricsCollector(this.manager);
      return true;
    } catch (error) {
      this.renderer.showStatus((error as Error).message, 'error');
      await this.renderer.pressEnterToContinue();
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    if (this.manager) {
      await this.manager.dispose();
      this.manager = null;
      this.collector = null;
    }
  }

  /**
   * Show pool metrics
   */
  private async showPoolMetrics(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Pool Metrics');

    if (!(await this.ensureInitialized())) {
      return this.show();
    }

    console.log(chalk.dim('  Collecting pool metrics...\n'));

    try {
      const metrics = await this.collector!.collect({ includeHealth: false });
      const summary = this.collector!.calculateSummary(metrics);

      this.printPoolMetrics(metrics, summary);
    } catch (error) {
      this.renderer.showStatus((error as Error).message, 'error');
    }

    console.log('');

    const action = await select({
      message: 'What next?',
      choices: [
        { name: 'Refresh metrics', value: 'refresh' },
        { name: 'Include health check', value: 'health' },
        { name: 'View Prometheus format', value: 'prometheus' },
        { name: chalk.gray('← Back to metrics menu'), value: 'menu' },
        { name: chalk.gray('← Back to main menu'), value: 'back' },
      ],
    });

    switch (action) {
      case 'refresh':
        return this.showPoolMetrics();
      case 'health':
        return this.showHealthMetrics();
      case 'prometheus':
        return this.showPrometheusExport();
      case 'menu':
        return this.show();
      default:
        await this.cleanup();
        return { type: 'back' };
    }
  }

  /**
   * Show health metrics
   */
  private async showHealthMetrics(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Health Check');

    if (!(await this.ensureInitialized())) {
      return this.show();
    }

    console.log(chalk.dim('  Running health check (pinging all pools)...\n'));

    try {
      const startTime = Date.now();
      const metrics = await this.collector!.collect({ includeHealth: true });
      const summary = this.collector!.calculateSummary(metrics);
      const durationMs = Date.now() - startTime;

      this.printHealthMetrics(metrics, summary, durationMs);
    } catch (error) {
      this.renderer.showStatus((error as Error).message, 'error');
    }

    console.log('');

    const action = await select({
      message: 'What next?',
      choices: [
        { name: 'Run health check again', value: 'refresh' },
        { name: 'View pool metrics only', value: 'pools' },
        { name: 'View Prometheus format', value: 'prometheus' },
        { name: chalk.gray('← Back to metrics menu'), value: 'menu' },
        { name: chalk.gray('← Back to main menu'), value: 'back' },
      ],
    });

    switch (action) {
      case 'refresh':
        return this.showHealthMetrics();
      case 'pools':
        return this.showPoolMetrics();
      case 'prometheus':
        return this.showPrometheusExport();
      case 'menu':
        return this.show();
      default:
        await this.cleanup();
        return { type: 'back' };
    }
  }

  /**
   * Show Prometheus export
   */
  private async showPrometheusExport(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Prometheus Export');

    if (!(await this.ensureInitialized())) {
      return this.show();
    }

    console.log(chalk.dim('  Collecting metrics for Prometheus export...\n'));

    try {
      const metrics = await this.collector!.collect({ includeHealth: true });
      const runtime = this.collector!.getRuntimeMetrics();
      const exporter = new PrometheusExporter({ prefix: 'drizzle_multitenant' });
      const text = exporter.export(metrics, runtime);

      // Show export with syntax highlighting
      console.log(chalk.bold('  Prometheus Text Format:'));
      console.log('');

      // Print with basic syntax highlighting
      for (const line of text.split('\n')) {
        if (line.startsWith('# HELP')) {
          console.log(chalk.dim(`  ${line}`));
        } else if (line.startsWith('# TYPE')) {
          console.log(chalk.dim(`  ${line}`));
        } else if (line.trim()) {
          // Highlight metric name
          const [name, value] = line.split(' ');
          if (name && value !== undefined) {
            const formattedName = name.includes('{')
              ? name.replace(/\{([^}]+)\}/, (_, labels) => `{${chalk.cyan(labels)}}`)
              : name;
            console.log(`  ${chalk.green(formattedName)} ${chalk.yellow(value)}`);
          } else {
            console.log(`  ${line}`);
          }
        }
      }

      console.log('');
      console.log(chalk.dim('  Tip: Use "drizzle-multitenant metrics --prometheus" to pipe to curl'));
    } catch (error) {
      this.renderer.showStatus((error as Error).message, 'error');
    }

    console.log('');

    const action = await select({
      message: 'What next?',
      choices: [
        { name: 'Refresh export', value: 'refresh' },
        { name: 'View pool metrics', value: 'pools' },
        { name: 'View health check', value: 'health' },
        { name: chalk.gray('← Back to metrics menu'), value: 'menu' },
        { name: chalk.gray('← Back to main menu'), value: 'back' },
      ],
    });

    switch (action) {
      case 'refresh':
        return this.showPrometheusExport();
      case 'pools':
        return this.showPoolMetrics();
      case 'health':
        return this.showHealthMetrics();
      case 'menu':
        return this.show();
      default:
        await this.cleanup();
        return { type: 'back' };
    }
  }

  /**
   * Show runtime metrics
   */
  private async showRuntimeMetrics(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Runtime Metrics');

    if (!(await this.ensureInitialized())) {
      return this.show();
    }

    try {
      const runtime = this.collector!.getRuntimeMetrics();

      console.log(chalk.bold('  Node.js Process Metrics:'));
      console.log('');
      console.log(`    Uptime: ${chalk.cyan(this.formatUptime(runtime.uptimeSeconds))}`);
      console.log('');
      console.log(chalk.bold('  Memory Usage:'));
      console.log(`    Heap Total:    ${chalk.cyan(this.formatBytes(runtime.memoryUsage.heapTotal))}`);
      console.log(`    Heap Used:     ${chalk.cyan(this.formatBytes(runtime.memoryUsage.heapUsed))}`);
      console.log(`    External:      ${chalk.cyan(this.formatBytes(runtime.memoryUsage.external))}`);
      console.log(`    RSS:           ${chalk.cyan(this.formatBytes(runtime.memoryUsage.rss))}`);
      console.log('');
      console.log(chalk.bold('  Event Loop:'));
      console.log(`    Active Handles:   ${runtime.activeHandles}`);
      console.log(`    Active Requests:  ${runtime.activeRequests}`);
    } catch (error) {
      this.renderer.showStatus((error as Error).message, 'error');
    }

    console.log('');

    const action = await select({
      message: 'What next?',
      choices: [
        { name: 'Refresh runtime metrics', value: 'refresh' },
        { name: 'View pool metrics', value: 'pools' },
        { name: 'View health check', value: 'health' },
        { name: chalk.gray('← Back to metrics menu'), value: 'menu' },
        { name: chalk.gray('← Back to main menu'), value: 'back' },
      ],
    });

    switch (action) {
      case 'refresh':
        return this.showRuntimeMetrics();
      case 'pools':
        return this.showPoolMetrics();
      case 'health':
        return this.showHealthMetrics();
      case 'menu':
        return this.show();
      default:
        await this.cleanup();
        return { type: 'back' };
    }
  }

  /**
   * Print pool metrics
   */
  private printPoolMetrics(
    metrics: AggregatedMetrics,
    summary: ReturnType<MetricsCollector['calculateSummary']>
  ): void {
    console.log(chalk.bold('  Pool Status:'));
    console.log(`    Active Pools: ${chalk.cyan(String(metrics.pools.pools.total))} / ${metrics.pools.pools.maxPools}`);
    console.log(`    Total Connections: ${summary.totalConnections}`);
    console.log(`    Idle Connections: ${chalk.green(String(summary.idleConnections))}`);
    console.log(
      `    Waiting Requests: ${summary.waitingRequests > 0 ? chalk.yellow(String(summary.waitingRequests)) : String(summary.waitingRequests)}`
    );

    console.log('');
    console.log(chalk.bold('  Shared Database:'));
    if (metrics.pools.shared.initialized) {
      const shared = metrics.pools.shared.connections!;
      console.log(`    Status: ${chalk.green('Initialized')}`);
      console.log(`    Connections: ${shared.total} total, ${shared.idle} idle, ${shared.waiting} waiting`);
    } else {
      console.log(`    Status: ${chalk.dim('Not initialized')}`);
    }

    // Per-tenant details (if not too many)
    const tenants = metrics.pools.pools.tenants;
    if (tenants.length > 0 && tenants.length <= 15) {
      console.log('');
      console.log(chalk.bold('  Active Tenants:'));

      for (const tenant of tenants) {
        const waitingColor = tenant.connections.waiting > 0 ? chalk.yellow : (x: string) => x;

        console.log(
          `    ${chalk.cyan(tenant.tenantId)}: ` +
            `${tenant.connections.total} conn, ` +
            `${tenant.connections.idle} idle, ` +
            `${waitingColor(String(tenant.connections.waiting))} waiting`
        );
      }
    } else if (tenants.length > 15) {
      console.log('');
      console.log(chalk.dim(`    (${tenants.length} active tenants)`));
    }

    console.log('');
    console.log(chalk.dim(`  Collected at ${metrics.collectedAt}`));
  }

  /**
   * Print health metrics
   */
  private printHealthMetrics(
    metrics: AggregatedMetrics,
    summary: ReturnType<MetricsCollector['calculateSummary']>,
    durationMs: number
  ): void {
    if (!metrics.health) {
      this.printPoolMetrics(metrics, summary);
      return;
    }

    console.log(chalk.bold('  Health Status:'));
    const healthIcon = metrics.health.healthy ? chalk.green('✓') : chalk.red('✗');
    console.log(`    Overall: ${healthIcon} ${metrics.health.healthy ? 'Healthy' : 'Unhealthy'}`);
    console.log(
      `    Pools: ${chalk.green(String(summary.healthyPools))} healthy, ` +
        `${chalk.yellow(String(summary.degradedPools))} degraded, ` +
        `${chalk.red(String(summary.unhealthyPools))} unhealthy`
    );
    console.log(`    Shared DB: ${this.getStatusColor(metrics.health.sharedDb)(metrics.health.sharedDb)}`);
    if (metrics.health.sharedDbResponseTimeMs !== undefined) {
      console.log(`    Shared DB Latency: ${metrics.health.sharedDbResponseTimeMs}ms`);
    }
    console.log(`    Check Duration: ${durationMs}ms`);

    // Per-tenant health
    const pools = metrics.health.pools;
    if (pools.length > 0 && pools.length <= 15) {
      console.log('');
      console.log(chalk.bold('  Pool Health:'));

      for (const pool of pools) {
        const statusIcon = this.getStatusIcon(pool.status);
        const latency = pool.responseTimeMs ? chalk.dim(` (${pool.responseTimeMs}ms)`) : '';

        console.log(`    ${statusIcon} ${chalk.cyan(pool.tenantId)}${latency}`);

        if (pool.error) {
          console.log(`       ${chalk.red(pool.error)}`);
        }
      }
    } else if (pools.length > 15) {
      console.log('');
      console.log(chalk.dim(`    (${pools.length} pools checked)`));
    }

    console.log('');
    console.log(chalk.dim(`  Collected at ${metrics.collectedAt}`));
  }

  /**
   * Get status icon
   */
  private getStatusIcon(status: 'ok' | 'degraded' | 'unhealthy'): string {
    switch (status) {
      case 'ok':
        return chalk.green('●');
      case 'degraded':
        return chalk.yellow('◐');
      case 'unhealthy':
        return chalk.red('○');
    }
  }

  /**
   * Get status color function
   */
  private getStatusColor(status: 'ok' | 'degraded' | 'unhealthy'): (text: string) => string {
    switch (status) {
      case 'ok':
        return chalk.green;
      case 'degraded':
        return chalk.yellow;
      case 'unhealthy':
        return chalk.red;
    }
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Format uptime to human-readable string
   */
  private formatUptime(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}
