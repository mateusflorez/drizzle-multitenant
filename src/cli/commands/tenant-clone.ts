import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { createMigrator } from '../../migrator/migrator.js';
import type { AnonymizeRules } from '../../migrator/clone/types.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  success,
  warning,
  dim,
  bold,
  red,
} from '../utils/index.js';

export const tenantCloneCommand = new Command('tenant:clone')
  .description('Clone a tenant schema to a new tenant')
  .requiredOption('--from <tenantId>', 'Source tenant ID')
  .requiredOption('--to <tenantId>', 'Target tenant ID')
  .option('-c, --config <path>', 'Path to config file')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .option('--include-data', 'Include data in clone (default: schema only)')
  .option('--anonymize', 'Anonymize sensitive data (requires --include-data)')
  .option('--anonymize-config <path>', 'Path to anonymization config file')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--json', 'Output as JSON')
  .addHelpText(
    'after',
    `
Examples:
  # Clone schema only
  $ drizzle-multitenant tenant:clone --from=production --to=dev

  # Clone with data
  $ drizzle-multitenant tenant:clone --from=production --to=dev --include-data

  # Clone with data anonymization
  $ drizzle-multitenant tenant:clone --from=production --to=dev --include-data --anonymize

  # Clone with custom anonymization rules
  $ drizzle-multitenant tenant:clone --from=prod --to=dev --include-data --anonymize --anonymize-config=./anonymize.config.js
`
  )
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
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery: async () => [],
      });

      const sourceSchema = config.isolation.schemaNameTemplate(options.from);
      const targetSchema = config.isolation.schemaNameTemplate(options.to);

      spinner.text = `Checking source tenant ${options.from}...`;

      // Check if source exists
      const sourceExists = await migrator.tenantExists(options.from);
      if (!sourceExists) {
        spinner.fail(`Source tenant ${options.from} does not exist`);
        process.exit(1);
      }

      // Check if target already exists
      const targetExists = await migrator.tenantExists(options.to);
      if (targetExists) {
        spinner.fail(`Target tenant ${options.to} already exists`);
        process.exit(1);
      }

      spinner.stop();

      // Confirmation
      if (!options.force) {
        console.log('');
        console.log(bold('Clone Configuration:'));
        console.log(dim(`  Source: ${options.from} (${sourceSchema})`));
        console.log(dim(`  Target: ${options.to} (${targetSchema})`));

        if (options.includeData) {
          console.log(warning('\n  This will copy all data from source tenant.'));
          if (options.anonymize) {
            console.log(dim('  Sensitive data will be anonymized.'));
          }
        } else {
          console.log(dim('\n  Schema only (no data will be copied).'));
        }

        const confirmed = await askConfirmation(
          `\nType "${options.to}" to confirm: `,
          options.to
        );

        if (!confirmed) {
          console.log('\n' + warning('Operation cancelled.'));
          return;
        }
      }

      // Load anonymization rules if provided
      let anonymizeRules: AnonymizeRules | undefined;
      if (options.anonymize && options.anonymizeConfig) {
        try {
          const configPath = await import('node:path').then((m) =>
            m.resolve(process.cwd(), options.anonymizeConfig)
          );
          const configModule = await import(configPath);
          anonymizeRules = configModule.default || configModule;
        } catch (err) {
          spinner.fail(`Failed to load anonymization config: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      spinner.start();
      spinner.text = `Cloning ${options.from} to ${options.to}...`;

      const result = await migrator.cloneTenant(options.from, options.to, {
        includeData: options.includeData,
        anonymize: options.anonymize
          ? {
              enabled: true,
              rules: anonymizeRules,
            }
          : undefined,
        onProgress: (status, details) => {
          switch (status) {
            case 'introspecting':
              spinner.text = 'Introspecting source schema...';
              break;
            case 'creating_schema':
              spinner.text = 'Creating target schema...';
              break;
            case 'creating_tables':
              spinner.text = 'Creating tables...';
              break;
            case 'creating_indexes':
              spinner.text = 'Creating indexes...';
              break;
            case 'creating_constraints':
              spinner.text = 'Creating constraints...';
              break;
            case 'copying_data':
              if (details?.table) {
                spinner.text = `Copying data: ${details.table} (${details.progress}/${details.total})...`;
              } else {
                spinner.text = 'Copying data...';
              }
              break;
          }
        },
      });

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.success) {
        spinner.fail(result.error ?? 'Clone failed');
        process.exit(1);
      }

      spinner.succeed(`Tenant ${options.to} cloned successfully`);

      console.log('');
      console.log(success('Source: ') + dim(`${options.from} (${sourceSchema})`));
      console.log(success('Target: ') + dim(`${options.to} (${targetSchema})`));
      console.log(success('Tables: ') + dim(result.tables.length.toString()));

      if (options.includeData && result.rowsCopied !== undefined) {
        console.log(success('Rows copied: ') + dim(result.rowsCopied.toLocaleString()));
        if (options.anonymize) {
          console.log(success('Data anonymized: ') + dim('Yes'));
        }
      }

      console.log(dim(`\nDuration: ${result.durationMs}ms`));
      console.log(dim('\nUsage:'));
      console.log(dim(`  const db = tenants.getDb('${options.to}');`));
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });

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
