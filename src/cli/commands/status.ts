import { Command } from 'commander';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  createStatusTable,
  createPendingSummary,
  error,
  bold,
} from '../utils/index.js';

export const statusCommand = new Command('status')
  .description('Show migration status for all tenants')
  .option('-c, --config <path>', 'Path to config file')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .action(async (options) => {
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, tenantDiscovery } = await loadConfig(options.config);

      if (!tenantDiscovery) {
        throw new Error(
          'No tenant discovery function configured. Add migrations.tenantDiscovery to your config.'
        );
      }

      const folder = options.migrationsFolder
        ? resolveMigrationsFolder(options.migrationsFolder)
        : resolveMigrationsFolder(migrationsFolder);

      spinner.text = 'Discovering tenants...';

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        tenantDiscovery,
      });

      spinner.text = 'Fetching migration status...';

      const statuses = await migrator.getStatus();

      spinner.succeed(`Found ${statuses.length} tenant${statuses.length > 1 ? 's' : ''}`);

      console.log('\n' + bold('Migration Status:'));
      console.log(createStatusTable(statuses));
      console.log(createPendingSummary(statuses));
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
