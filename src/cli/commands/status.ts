import { Command } from 'commander';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  createStatusTable,
  createPendingSummary,
  CLIErrors,
  handleError,
  getOutputContext,
  log,
  debug,
  outputJson,
  bold,
} from '../utils/index.js';
import type { StatusJsonOutput, StatusOptions } from '../types.js';

export const statusCommand = new Command('status')
  .description('Show migration status for all tenants')
  .option('-c, --config <path>', 'Path to config file')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant status
  $ drizzle-multitenant status --json
  $ drizzle-multitenant status --json | jq '.tenants[] | select(.pending > 0)'
  $ drizzle-multitenant status --verbose
`)
  .action(async (options: StatusOptions) => {
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

      spinner.text = 'Discovering tenants...';

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery,
      });

      spinner.text = 'Fetching migration status...';

      const statuses = await migrator.getStatus();

      spinner.succeed(`Found ${statuses.length} tenant${statuses.length > 1 ? 's' : ''}`);

      // Calculate summary
      const summary = {
        total: statuses.length,
        upToDate: statuses.filter(s => s.status === 'ok').length,
        behind: statuses.filter(s => s.status === 'behind').length,
        error: statuses.filter(s => s.status === 'error').length,
      };

      debug(`Summary: ${summary.upToDate} up-to-date, ${summary.behind} behind, ${summary.error} errors`);

      // JSON output
      if (ctx.jsonMode) {
        const jsonOutput: StatusJsonOutput = {
          tenants: statuses.map(s => ({
            id: s.tenantId,
            schema: s.schemaName,
            format: s.format,
            applied: s.appliedCount,
            pending: s.pendingCount,
            status: s.status,
            pendingMigrations: s.pendingMigrations,
            error: s.error,
          })),
          summary,
        };
        outputJson(jsonOutput);
        return;
      }

      // Human-readable output
      log('\n' + bold('Migration Status:'));
      log(createStatusTable(statuses));
      log(createPendingSummary(statuses));
    } catch (err) {
      spinner.fail((err as Error).message);
      handleError(err);
    }
  });
