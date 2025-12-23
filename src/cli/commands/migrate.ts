import { Command } from 'commander';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  createResultsTable,
  success,
  error,
  info,
  warning,
  bold,
  dim,
} from '../utils/index.js';

export const migrateCommand = new Command('migrate')
  .description('Apply pending migrations to tenant schemas')
  .option('-c, --config <path>', 'Path to config file')
  .option('-a, --all', 'Migrate all tenants')
  .option('-t, --tenant <id>', 'Migrate a specific tenant')
  .option('--tenants <ids>', 'Migrate specific tenants (comma-separated)')
  .option('--concurrency <number>', 'Number of concurrent migrations', '10')
  .option('--dry-run', 'Show what would be applied without executing')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .action(async (options) => {
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, tenantDiscovery } = await loadConfig(options.config);

      const folder = options.migrationsFolder
        ? resolveMigrationsFolder(options.migrationsFolder)
        : resolveMigrationsFolder(migrationsFolder);

      // Determine tenant discovery function
      let discoveryFn: () => Promise<string[]>;

      if (options.tenant) {
        discoveryFn = async () => [options.tenant];
      } else if (options.tenants) {
        const tenantIds = options.tenants.split(',').map((id: string) => id.trim());
        discoveryFn = async () => tenantIds;
      } else if (options.all) {
        if (!tenantDiscovery) {
          throw new Error(
            'No tenant discovery function configured. Add migrations.tenantDiscovery to your config.'
          );
        }
        discoveryFn = tenantDiscovery;
      } else {
        spinner.stop();
        console.log(error('Please specify --all, --tenant, or --tenants'));
        console.log(dim('\nExamples:'));
        console.log(dim('  npx drizzle-multitenant migrate --all'));
        console.log(dim('  npx drizzle-multitenant migrate --tenant=tenant-uuid'));
        console.log(dim('  npx drizzle-multitenant migrate --tenants=tenant-1,tenant-2'));
        process.exit(1);
      }

      spinner.text = 'Discovering tenants...';

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        tenantDiscovery: discoveryFn,
      });

      const tenantIds = await discoveryFn();

      if (tenantIds.length === 0) {
        spinner.stop();
        console.log(warning('No tenants found.'));
        return;
      }

      spinner.text = `Found ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}`;
      spinner.succeed();

      if (options.dryRun) {
        console.log(info(bold('\nDry run mode - no changes will be made\n')));
      }

      console.log(info(`Migrating ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}...\n`));

      const concurrency = parseInt(options.concurrency, 10);
      let completed = 0;

      const results = await migrator.migrateAll({
        concurrency,
        dryRun: options.dryRun,
        onProgress: (tenantId, status, migrationName) => {
          if (status === 'completed') {
            completed++;
            const progress = `[${completed}/${tenantIds.length}]`;
            console.log(`${dim(progress)} ${success(tenantId)}`);
          } else if (status === 'failed') {
            completed++;
            const progress = `[${completed}/${tenantIds.length}]`;
            console.log(`${dim(progress)} ${error(tenantId)}`);
          } else if (status === 'migrating' && migrationName) {
            // Optional: show individual migration progress
          }
        },
        onError: (tenantId, err) => {
          console.log(error(`${tenantId}: ${err.message}`));
          return 'continue';
        },
      });

      console.log('\n' + bold('Results:'));
      console.log(createResultsTable(results.details));

      console.log('\n' + bold('Summary:'));
      console.log(`  Total:     ${results.total}`);
      console.log(`  Succeeded: ${success(results.succeeded.toString())}`);
      if (results.failed > 0) {
        console.log(`  Failed:    ${error(results.failed.toString())}`);
      }
      if (results.skipped > 0) {
        console.log(`  Skipped:   ${warning(results.skipped.toString())}`);
      }

      if (results.failed > 0) {
        process.exit(1);
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
