import { Command } from 'commander';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
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

interface MigrateSharedOptions {
  config?: string;
  migrationsFolder?: string;
  dryRun?: boolean;
  markApplied?: boolean;
}

interface MigrateSharedJsonOutput {
  schemaName: string;
  success: boolean;
  appliedMigrations: string[];
  durationMs: number;
  format?: string;
  error?: string;
}

export const migrateSharedCommand = new Command('migrate:shared')
  .description('Apply pending migrations to the shared schema (public)')
  .option('-c, --config <path>', 'Path to config file')
  .option('--migrations-folder <path>', 'Path to shared migrations folder')
  .option('--dry-run', 'Show what would be applied without executing')
  .option('--mark-applied', 'Mark migrations as applied without executing SQL')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant migrate:shared
  $ drizzle-multitenant migrate:shared --dry-run
  $ drizzle-multitenant migrate:shared --mark-applied
  $ drizzle-multitenant migrate:shared --migrations-folder=./drizzle/shared-migrations
  $ drizzle-multitenant migrate:shared --json
`)
  .action(async (options: MigrateSharedOptions) => {
    const startTime = Date.now();
    const ctx = getOutputContext();
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const loadedConfig = await loadConfig(options.config);
      const { config, sharedMigrationsFolder, migrationsTable, tenantDiscovery } = loadedConfig;

      // Determine shared migrations folder
      const folder = options.migrationsFolder
        ? resolveMigrationsFolder(options.migrationsFolder)
        : sharedMigrationsFolder
          ? resolveMigrationsFolder(sharedMigrationsFolder)
          : null;

      if (!folder) {
        spinner.fail('Shared migrations folder not configured');
        throw CLIErrors.create(
          'Shared migrations folder not configured',
          'Set sharedMigrationsFolder in your config file or use --migrations-folder option',
          'drizzle-multitenant migrate:shared --migrations-folder=./drizzle/shared-migrations'
        );
      }

      debug(`Using shared migrations folder: ${folder}`);

      spinner.text = 'Checking shared migrations...';

      const migrator = createMigrator(config, {
        migrationsFolder: loadedConfig.migrationsFolder ?? './drizzle/tenant-migrations',
        sharedMigrationsFolder: folder,
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery: tenantDiscovery ?? (async () => []),
      });

      // Check if shared migrations are available
      if (!migrator.hasSharedMigrations()) {
        spinner.fail('Shared migrations not available');
        throw CLIErrors.create(
          'Shared migrations folder does not exist or is empty',
          `Create the folder at: ${folder}`,
          `mkdir -p ${folder}`
        );
      }

      // Get status first
      const status = await migrator.getSharedStatus();

      if (status.status === 'error') {
        spinner.fail('Failed to get shared migration status');
        throw new Error(status.error);
      }

      if (status.pendingCount === 0) {
        spinner.succeed('Shared schema is up to date');
        log(info('\nNo pending migrations.'));

        if (ctx.jsonMode) {
          const jsonOutput: MigrateSharedJsonOutput = {
            schemaName: status.schemaName,
            success: true,
            appliedMigrations: [],
            durationMs: Date.now() - startTime,
            format: status.format ?? undefined,
          };
          outputJson(jsonOutput);
        }

        return;
      }

      spinner.succeed(`Found ${status.pendingCount} pending migration${status.pendingCount > 1 ? 's' : ''}`);

      if (options.dryRun) {
        log(info(bold('\nDry run mode - no changes will be made\n')));
      }

      if (options.markApplied) {
        log(info(bold('\nMark-applied mode - migrations will be recorded without executing SQL\n')));
      }

      const actionLabel = options.markApplied ? 'Marking' : 'Applying';
      log(info(`\n${actionLabel} ${status.pendingCount} migration${status.pendingCount > 1 ? 's' : ''} to shared schema...\n`));

      // Log pending migrations
      for (const migrationName of status.pendingMigrations) {
        log(dim(`  - ${migrationName}`));
      }
      log('');

      const migrationSpinner = createSpinner(`${actionLabel} migrations...`);
      migrationSpinner.start();

      const result = options.markApplied
        ? await migrator.markSharedAsApplied({
            onProgress: (progressStatus, migrationName) => {
              if (progressStatus === 'migrating' && migrationName) {
                migrationSpinner.text = `Marking: ${migrationName}`;
              }
            },
          })
        : await migrator.migrateShared({
            dryRun: options.dryRun,
            onProgress: (progressStatus, migrationName) => {
              if (progressStatus === 'migrating' && migrationName) {
                migrationSpinner.text = `Applying: ${migrationName}`;
              }
            },
          });

      const totalDuration = Date.now() - startTime;

      if (result.success) {
        migrationSpinner.succeed(`${options.dryRun ? 'Would apply' : 'Applied'} ${result.appliedMigrations.length} migration${result.appliedMigrations.length > 1 ? 's' : ''}`);
      } else {
        migrationSpinner.fail('Migration failed');
      }

      // JSON output
      if (ctx.jsonMode) {
        const jsonOutput: MigrateSharedJsonOutput = {
          schemaName: result.schemaName,
          success: result.success,
          appliedMigrations: result.appliedMigrations,
          durationMs: totalDuration,
          format: result.format,
          error: result.error,
        };
        outputJson(jsonOutput);
        process.exit(result.success ? 0 : 1);
      }

      // Human-readable output
      if (result.success) {
        log('\n' + bold('Applied migrations:'));
        for (const name of result.appliedMigrations) {
          log(`  ${success('✓')} ${name}`);
        }
        log(`\n${dim(`Duration: ${formatDuration(totalDuration)}`)}`);
      } else {
        log(`\n${error('Error:')} ${result.error}`);
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
