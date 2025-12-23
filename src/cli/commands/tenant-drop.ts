import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  success,
  error,
  warning,
  dim,
  red,
  bold,
} from '../utils/index.js';

export const tenantDropCommand = new Command('tenant:drop')
  .description('Drop a tenant schema (DESTRUCTIVE)')
  .requiredOption('--id <tenantId>', 'Tenant ID')
  .option('-c, --config <path>', 'Path to config file')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--no-cascade', 'Use RESTRICT instead of CASCADE')
  .action(async (options) => {
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder } = await loadConfig(options.config);

      const folder = options.migrationsFolder
        ? resolveMigrationsFolder(options.migrationsFolder)
        : resolveMigrationsFolder(migrationsFolder);

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        tenantDiscovery: async () => [],
      });

      const schemaName = config.isolation.schemaNameTemplate(options.id);

      spinner.text = `Checking if tenant ${options.id} exists...`;

      const exists = await migrator.tenantExists(options.id);
      if (!exists) {
        spinner.warn(`Tenant ${options.id} does not exist`);
        return;
      }

      spinner.stop();

      // Confirmation prompt
      if (!options.force) {
        console.log(red(bold('\n⚠️  WARNING: This action is DESTRUCTIVE and IRREVERSIBLE!')));
        console.log(dim(`\nYou are about to drop schema: ${schemaName}`));
        console.log(dim('All tables and data in this schema will be permanently deleted.\n'));

        const confirmed = await askConfirmation(
          `Type "${options.id}" to confirm deletion: `,
          options.id
        );

        if (!confirmed) {
          console.log('\n' + warning('Operation cancelled.'));
          return;
        }
      }

      spinner.start();
      spinner.text = `Dropping tenant schema ${schemaName}...`;

      await migrator.dropTenant(options.id, {
        cascade: options.cascade,
      });

      spinner.succeed(`Tenant ${options.id} dropped`);

      console.log('\n' + success('Schema deleted: ') + dim(schemaName));
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });

/**
 * Ask for confirmation
 */
async function askConfirmation(question: string, expected: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim() === expected);
    });
  });
}
