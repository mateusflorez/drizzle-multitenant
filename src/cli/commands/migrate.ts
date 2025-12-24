import { Command } from 'commander';
import { checkbox } from '@inquirer/prompts';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createResultsTable,
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
  shouldShowInteractive,
} from '../utils/index.js';
import type { MigrateJsonOutput, MigrateOptions } from '../types.js';

export const migrateCommand = new Command('migrate')
  .description('Apply pending migrations to tenant schemas')
  .option('-c, --config <path>', 'Path to config file')
  .option('-a, --all', 'Migrate all tenants')
  .option('-t, --tenant <id>', 'Migrate a specific tenant')
  .option('--tenants <ids>', 'Migrate specific tenants (comma-separated)')
  .option('--concurrency <number>', 'Number of concurrent migrations', '10')
  .option('--dry-run', 'Show what would be applied without executing')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant migrate --all
  $ drizzle-multitenant migrate --tenant=my-tenant
  $ drizzle-multitenant migrate --tenants=tenant-1,tenant-2
  $ drizzle-multitenant migrate --all --dry-run
  $ drizzle-multitenant migrate --all --concurrency=5
  $ drizzle-multitenant migrate --all --json
`)
  .action(async (options: MigrateOptions) => {
    const startTime = Date.now();
    const ctx = getOutputContext();
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, migrationsTable, tenantDiscovery } = await loadConfig(options.config);

      const folder = options.migrationsFolder
        ? resolveMigrationsFolder(options.migrationsFolder)
        : resolveMigrationsFolder(migrationsFolder);

      debug(`Using migrations folder: ${folder}`);

      // Determine tenant discovery function
      let discoveryFn: () => Promise<string[]>;
      let tenantIds: string[];

      if (options.tenant) {
        discoveryFn = async () => [options.tenant!];
        tenantIds = [options.tenant];
      } else if (options.tenants) {
        const ids = options.tenants.split(',').map((id: string) => id.trim());
        discoveryFn = async () => ids;
        tenantIds = ids;
      } else if (options.all) {
        if (!tenantDiscovery) {
          throw CLIErrors.noTenantDiscovery();
        }
        discoveryFn = tenantDiscovery;
        spinner.text = 'Discovering tenants...';
        tenantIds = await tenantDiscovery();
      } else {
        spinner.stop();

        // Interactive mode: let user select tenants
        if (shouldShowInteractive() && tenantDiscovery) {
          log(info('No tenants specified. Fetching available tenants...\n'));

          const availableTenants = await tenantDiscovery();

          if (availableTenants.length === 0) {
            log(warning('No tenants found.'));
            return;
          }

          const selectedTenants = await checkbox({
            message: 'Select tenants to migrate:',
            choices: availableTenants.map(id => ({ name: id, value: id })),
            pageSize: 15,
          });

          if (selectedTenants.length === 0) {
            log(warning('No tenants selected. Aborting.'));
            return;
          }

          discoveryFn = async () => selectedTenants;
          tenantIds = selectedTenants;
        } else {
          throw CLIErrors.noTenantSpecified();
        }
      }

      if (tenantIds.length === 0) {
        spinner.stop();
        log(warning('No tenants found.'));
        return;
      }

      spinner.text = `Found ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}`;
      spinner.succeed();

      if (options.dryRun) {
        log(info(bold('\nDry run mode - no changes will be made\n')));
      }

      log(info(`Migrating ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}...\n`));

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery: discoveryFn,
      });

      const concurrency = parseInt(options.concurrency || '10', 10);

      // Use progress bar for interactive mode, simple logs otherwise
      const progressBar = createProgressBar({ total: tenantIds.length });
      progressBar.start();

      const results = await migrator.migrateAll({
        concurrency,
        dryRun: !!options.dryRun,
        onProgress: (tenantId, status, migrationName) => {
          if (status === 'completed') {
            progressBar.increment({ tenant: tenantId, status: 'success' });
            debug(`Completed: ${tenantId}`);
          } else if (status === 'failed') {
            progressBar.increment({ tenant: tenantId, status: 'error' });
            debug(`Failed: ${tenantId}`);
          } else if (status === 'migrating' && migrationName) {
            debug(`${tenantId}: Applying ${migrationName}`);
          }
        },
        onError: (tenantId, err) => {
          debug(`Error on ${tenantId}: ${err.message}`);
          return 'continue';
        },
      });

      progressBar.stop();

      const totalDuration = Date.now() - startTime;

      // JSON output
      if (ctx.jsonMode) {
        const jsonOutput: MigrateJsonOutput = {
          results: results.details.map(r => ({
            tenantId: r.tenantId,
            schema: r.schemaName,
            success: r.success,
            appliedMigrations: r.appliedMigrations,
            durationMs: r.durationMs,
            format: r.format,
            error: r.error,
          })),
          summary: {
            total: results.total,
            succeeded: results.succeeded,
            failed: results.failed,
            skipped: results.skipped,
            durationMs: totalDuration,
            averageMs: results.total > 0 ? Math.round(totalDuration / results.total) : undefined,
          },
        };
        outputJson(jsonOutput);
        process.exit(results.failed > 0 ? 1 : 0);
      }

      // Human-readable output
      log('\n' + bold('Results:'));
      log(createResultsTable(results.details));

      log('\n' + bold('Summary:'));
      log(`  Total:      ${results.total}`);
      log(`  Succeeded:  ${success(results.succeeded.toString())}`);
      if (results.failed > 0) {
        log(`  Failed:     ${error(results.failed.toString())}`);
      }
      if (results.skipped > 0) {
        log(`  Skipped:    ${warning(results.skipped.toString())}`);
      }
      log(`  Duration:   ${dim(formatDuration(totalDuration))}`);
      if (results.total > 0) {
        log(`  Average:    ${dim(formatDuration(Math.round(totalDuration / results.total)) + '/tenant')}`);
      }

      // Show failed tenants summary
      if (results.failed > 0) {
        log('\n' + bold('Failed tenants:'));
        for (const detail of results.details.filter(d => !d.success)) {
          log(`  ${error(detail.tenantId)}: ${dim(detail.error || 'Unknown error')}`);
        }
        log('\n' + dim('Run with --verbose to see more details.'));
      }

      if (results.failed > 0) {
        process.exit(1);
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
