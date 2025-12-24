import { Command } from 'commander';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  success,
  error,
  warning,
  dim,
} from '../utils/index.js';

export const tenantCreateCommand = new Command('tenant:create')
  .description('Create a new tenant schema and apply all migrations')
  .requiredOption('--id <tenantId>', 'Tenant ID')
  .option('-c, --config <path>', 'Path to config file')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .option('--no-migrate', 'Skip applying migrations after creating schema')
  .action(async (options) => {
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, migrationsTable } = await loadConfig(options.config);

      const folder = options.migrationsFolder
        ? resolveMigrationsFolder(options.migrationsFolder)
        : resolveMigrationsFolder(migrationsFolder);

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        migrationsTable,
        tenantDiscovery: async () => [],
      });

      const schemaName = config.isolation.schemaNameTemplate(options.id);

      spinner.text = `Checking if tenant ${options.id} exists...`;

      const exists = await migrator.tenantExists(options.id);
      if (exists) {
        spinner.warn(`Tenant ${options.id} already exists (${schemaName})`);

        if (options.migrate) {
          spinner.start();
          spinner.text = 'Applying pending migrations...';

          const result = await migrator.migrateTenant(options.id);

          if (result.appliedMigrations.length > 0) {
            spinner.succeed(`Applied ${result.appliedMigrations.length} migration(s)`);
            for (const migration of result.appliedMigrations) {
              console.log(`  ${dim('-')} ${migration}`);
            }
          } else {
            spinner.succeed('No pending migrations');
          }
        }

        return;
      }

      spinner.text = `Creating tenant schema ${schemaName}...`;

      await migrator.createTenant(options.id, {
        migrate: options.migrate,
      });

      spinner.succeed(`Tenant ${options.id} created`);

      console.log('\n' + success('Schema created: ') + dim(schemaName));

      if (options.migrate) {
        console.log(success('All migrations applied'));
      } else {
        console.log(warning('Migrations skipped. Run migrate to apply.'));
      }

      console.log(dim('\nYou can now use this tenant:'));
      console.log(dim(`  const db = tenants.getDb('${options.id}');`));
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
