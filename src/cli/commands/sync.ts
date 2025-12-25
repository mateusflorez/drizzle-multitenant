import { Command } from 'commander';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  createProgressBar,
  CLIErrors,
  handleError,
  getOutputContext,
  log,
  debug,
  outputJson,
  success,
  error,
  info,
  warning,
  bold,
  dim,
} from '../utils/index.js';
import type { SyncOptions, SyncJsonOutput } from '../types.js';

export const syncCommand = new Command('sync')
  .description('Detect and fix divergences between migrations on disk and tracking in database')
  .option('-c, --config <path>', 'Path to config file')
  .option('-s, --status', 'Show sync status without making changes')
  .option('--mark-missing', 'Mark missing migrations as applied')
  .option('--clean-orphans', 'Remove orphan records from tracking table')
  .option('--concurrency <number>', 'Number of concurrent operations', '10')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant sync --status
  $ drizzle-multitenant sync --mark-missing
  $ drizzle-multitenant sync --clean-orphans
  $ drizzle-multitenant sync --mark-missing --clean-orphans
  $ drizzle-multitenant sync --status --json
`)
  .action(async (options: SyncOptions) => {
    const startTime = Date.now();
    const ctx = getOutputContext();
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, migrationsTable, tenantDiscovery } = await loadConfig(options.config);

      if (!tenantDiscovery) {
        throw CLIErrors.noTenantDiscovery();
      }

      const folder = options.migrationsFolder
        ? resolveMigrationsFolder(options.migrationsFolder)
        : resolveMigrationsFolder(migrationsFolder);

      debug(`Using migrations folder: ${folder}`);

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery,
      });

      // Default to status if no action specified
      const showStatus = options.status || (!options.markMissing && !options.cleanOrphans);

      if (showStatus) {
        spinner.text = 'Fetching sync status...';

        const syncStatus = await migrator.getSyncStatus();

        spinner.succeed(`Found ${syncStatus.total} tenant${syncStatus.total > 1 ? 's' : ''}`);

        // JSON output
        if (ctx.jsonMode) {
          const jsonOutput: SyncJsonOutput = {
            tenants: syncStatus.details.map(s => ({
              id: s.tenantId,
              schema: s.schemaName,
              format: s.format,
              inSync: s.inSync,
              missing: s.missing,
              orphans: s.orphans,
              error: s.error,
            })),
            summary: {
              total: syncStatus.total,
              inSync: syncStatus.inSync,
              outOfSync: syncStatus.outOfSync,
              error: syncStatus.error,
            },
          };
          outputJson(jsonOutput);
          return;
        }

        // Human-readable output
        log('\n' + bold('Sync Status:'));
        log(createSyncStatusTable(syncStatus.details));
        log(createSyncSummary(syncStatus));
        return;
      }

      // Execute sync actions
      const concurrency = parseInt(options.concurrency || '10', 10);

      if (options.markMissing) {
        spinner.text = 'Marking missing migrations...';
        spinner.succeed();

        const tenantIds = await tenantDiscovery();
        log(info(`\nMarking missing migrations for ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}...\n`));

        const progressBar = createProgressBar({ total: tenantIds.length });
        progressBar.start();

        const results = await migrator.markAllMissing({
          concurrency,
          onProgress: (tenantId, status) => {
            if (status === 'completed') {
              progressBar.increment({ tenant: tenantId, status: 'success' });
            } else if (status === 'failed') {
              progressBar.increment({ tenant: tenantId, status: 'error' });
            }
          },
          onError: (tenantId, err) => {
            debug(`Error on ${tenantId}: ${err.message}`);
            return 'continue';
          },
        });

        progressBar.stop();

        const totalDuration = Date.now() - startTime;

        if (ctx.jsonMode) {
          outputJson({
            action: 'mark-missing',
            results: results.details.map(r => ({
              tenantId: r.tenantId,
              schema: r.schemaName,
              success: r.success,
              markedMigrations: r.markedMigrations,
              durationMs: r.durationMs,
              error: r.error,
            })),
            summary: {
              total: results.total,
              succeeded: results.succeeded,
              failed: results.failed,
              durationMs: totalDuration,
            },
          });
          process.exit(results.failed > 0 ? 1 : 0);
        }

        log('\n' + bold('Results:'));
        log(createSyncResultsTable(results.details, 'mark-missing'));
        log('\n' + bold('Summary:'));
        log(`  Total:      ${results.total}`);
        log(`  Succeeded:  ${success(results.succeeded.toString())}`);
        if (results.failed > 0) {
          log(`  Failed:     ${error(results.failed.toString())}`);
        }
        log(`  Duration:   ${dim(formatDuration(totalDuration))}`);
      }

      if (options.cleanOrphans) {
        if (options.markMissing) {
          log('\n'); // Add space between operations
        }

        spinner.text = 'Cleaning orphan records...';
        spinner.succeed();

        const tenantIds = await tenantDiscovery();
        log(info(`\nCleaning orphan records for ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}...\n`));

        const progressBar = createProgressBar({ total: tenantIds.length });
        progressBar.start();

        const results = await migrator.cleanAllOrphans({
          concurrency,
          onProgress: (tenantId, status) => {
            if (status === 'completed') {
              progressBar.increment({ tenant: tenantId, status: 'success' });
            } else if (status === 'failed') {
              progressBar.increment({ tenant: tenantId, status: 'error' });
            }
          },
          onError: (tenantId, err) => {
            debug(`Error on ${tenantId}: ${err.message}`);
            return 'continue';
          },
        });

        progressBar.stop();

        const totalDuration = Date.now() - startTime;

        if (ctx.jsonMode) {
          outputJson({
            action: 'clean-orphans',
            results: results.details.map(r => ({
              tenantId: r.tenantId,
              schema: r.schemaName,
              success: r.success,
              removedOrphans: r.removedOrphans,
              durationMs: r.durationMs,
              error: r.error,
            })),
            summary: {
              total: results.total,
              succeeded: results.succeeded,
              failed: results.failed,
              durationMs: totalDuration,
            },
          });
          process.exit(results.failed > 0 ? 1 : 0);
        }

        log('\n' + bold('Results:'));
        log(createSyncResultsTable(results.details, 'clean-orphans'));
        log('\n' + bold('Summary:'));
        log(`  Total:      ${results.total}`);
        log(`  Succeeded:  ${success(results.succeeded.toString())}`);
        if (results.failed > 0) {
          log(`  Failed:     ${error(results.failed.toString())}`);
        }
        log(`  Duration:   ${dim(formatDuration(totalDuration))}`);
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      handleError(err);
    }
  });

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Create a table showing sync status
 */
function createSyncStatusTable(details: Array<{
  tenantId: string;
  schemaName: string;
  missing: string[];
  orphans: string[];
  inSync: boolean;
  error?: string;
}>): string {
  if (details.length === 0) {
    return '  No tenants found.\n';
  }

  const lines: string[] = [];

  for (const detail of details) {
    if (detail.error) {
      lines.push(`  ${error(detail.tenantId)}: ${dim(detail.error)}`);
    } else if (detail.inSync) {
      lines.push(`  ${success(detail.tenantId)}: ${dim('In sync')}`);
    } else {
      const issues: string[] = [];
      if (detail.missing.length > 0) {
        issues.push(`${detail.missing.length} missing`);
      }
      if (detail.orphans.length > 0) {
        issues.push(`${detail.orphans.length} orphan${detail.orphans.length > 1 ? 's' : ''}`);
      }
      lines.push(`  ${warning(detail.tenantId)}: ${issues.join(', ')}`);

      // Show details
      if (detail.missing.length > 0) {
        lines.push(`    ${dim('Missing:')} ${detail.missing.slice(0, 3).join(', ')}${detail.missing.length > 3 ? `, +${detail.missing.length - 3} more` : ''}`);
      }
      if (detail.orphans.length > 0) {
        lines.push(`    ${dim('Orphans:')} ${detail.orphans.slice(0, 3).join(', ')}${detail.orphans.length > 3 ? `, +${detail.orphans.length - 3} more` : ''}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Create a summary of sync status
 */
function createSyncSummary(status: {
  total: number;
  inSync: number;
  outOfSync: number;
  error: number;
}): string {
  const lines: string[] = [];

  lines.push('\n' + bold('Summary:'));
  lines.push(`  Total:       ${status.total}`);
  lines.push(`  In Sync:     ${success(status.inSync.toString())}`);
  if (status.outOfSync > 0) {
    lines.push(`  Out of Sync: ${warning(status.outOfSync.toString())}`);
  }
  if (status.error > 0) {
    lines.push(`  Errors:      ${error(status.error.toString())}`);
  }

  if (status.outOfSync > 0) {
    lines.push('\n' + dim('Run with --mark-missing to mark missing migrations as applied.'));
    lines.push(dim('Run with --clean-orphans to remove orphan records.'));
  }

  return lines.join('\n');
}

/**
 * Create a table showing sync results
 */
function createSyncResultsTable(
  details: Array<{
    tenantId: string;
    success: boolean;
    markedMigrations: string[];
    removedOrphans: string[];
    error?: string;
  }>,
  action: 'mark-missing' | 'clean-orphans'
): string {
  if (details.length === 0) {
    return '  No tenants processed.\n';
  }

  const lines: string[] = [];

  for (const detail of details) {
    if (detail.error) {
      lines.push(`  ${error(detail.tenantId)}: ${dim(detail.error)}`);
    } else if (action === 'mark-missing') {
      if (detail.markedMigrations.length > 0) {
        lines.push(`  ${success(detail.tenantId)}: Marked ${detail.markedMigrations.length} migration${detail.markedMigrations.length > 1 ? 's' : ''}`);
      } else {
        lines.push(`  ${dim(detail.tenantId)}: Nothing to mark`);
      }
    } else {
      if (detail.removedOrphans.length > 0) {
        lines.push(`  ${success(detail.tenantId)}: Removed ${detail.removedOrphans.length} orphan${detail.removedOrphans.length > 1 ? 's' : ''}`);
      } else {
        lines.push(`  ${dim(detail.tenantId)}: No orphans found`);
      }
    }
  }

  return lines.join('\n') + '\n';
}
