import { Command } from 'commander';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMigrator } from '../../migrator/migrator.js';
import type { SharedSeedFunction } from '../../migrator/types.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  handleError,
  getOutputContext,
  log,
  debug,
  outputJson,
  success,
  error,
  warning,
  bold,
  dim,
} from '../utils/index.js';

interface SeedSharedOptions {
  config?: string;
  file: string;
}

interface SeedSharedJsonOutput {
  result: {
    schema: string;
    success: boolean;
    durationMs: number;
    error?: string;
  };
}

export const seedSharedCommand = new Command('seed-shared')
  .description('Seed the shared schema (public) with initial data')
  .requiredOption('-f, --file <path>', 'Path to shared seed file (TypeScript or JavaScript)')
  .option('-c, --config <path>', 'Path to config file')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant seed-shared --file=./seeds/shared/plans.ts

Seed File Format:
  // seeds/shared/plans.ts
  import { SharedSeedFunction } from 'drizzle-multitenant';

  export const seed: SharedSeedFunction = async (db) => {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price: 0 },
      { id: 'pro', name: 'Pro', price: 29 },
      { id: 'enterprise', name: 'Enterprise', price: 99 },
    ]).onConflictDoNothing();
  };
`)
  .action(async (options: SeedSharedOptions) => {
    const startTime = Date.now();
    const ctx = getOutputContext();
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, migrationsTable, tenantDiscovery } = await loadConfig(options.config);

      const folder = resolveMigrationsFolder(migrationsFolder);

      debug(`Using migrations folder: ${folder}`);

      // Check if shared schema is configured
      if (!config.schemas?.shared) {
        spinner.fail('Shared schema not configured');
        log(`\n${warning('The shared schema (schemas.shared) is not configured.')}`);
        log(dim('\nAdd a shared schema to your config file:'));
        log(dim('  schemas: {'));
        log(dim('    tenant: tenantSchema,'));
        log(dim('    shared: sharedSchema, // <-- Add this'));
        log(dim('  }'));
        process.exit(1);
      }

      // Load the seed file
      spinner.text = 'Loading seed file...';
      const seedFilePath = resolve(process.cwd(), options.file);
      const seedFileUrl = pathToFileURL(seedFilePath).href;

      let seedFn: SharedSeedFunction;

      try {
        const seedModule = await import(seedFileUrl);
        seedFn = seedModule.seed || seedModule.default;

        if (typeof seedFn !== 'function') {
          throw new Error('Seed file must export a "seed" function or default export');
        }
      } catch (err) {
        spinner.fail('Failed to load seed file');
        const loadError = err as Error;
        if (loadError.message.includes('Cannot find module')) {
          log(`\n${warning(`Seed file not found: ${seedFilePath}`)}`);
          log(dim('\nMake sure the file exists and has the correct format:'));
          log(dim('  export const seed: SharedSeedFunction = async (db) => { ... };'));
        } else {
          log(`\n${warning(loadError.message)}`);
        }
        process.exit(1);
      }

      spinner.text = 'Seeding shared schema...';

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery: tenantDiscovery || (() => Promise.resolve([])),
      });

      const result = await migrator.seedShared(seedFn as any);

      const totalDuration = Date.now() - startTime;

      if (result.success) {
        spinner.succeed('Shared schema seeded successfully');
      } else {
        spinner.fail('Failed to seed shared schema');
      }

      // JSON output
      if (ctx.jsonMode) {
        const jsonOutput: SeedSharedJsonOutput = {
          result: {
            schema: result.schemaName,
            success: result.success,
            durationMs: result.durationMs,
            error: result.error,
          },
        };
        outputJson(jsonOutput);
        process.exit(result.success ? 0 : 1);
      }

      // Human-readable output
      log('\n' + bold('Summary:'));
      log(`  Schema:     ${result.schemaName}`);
      log(`  Status:     ${result.success ? success('success') : error('failed')}`);
      log(`  Duration:   ${dim(formatDuration(totalDuration))}`);

      if (result.error) {
        log(`\n${error('Error:')} ${result.error}`);
      }

      if (!result.success) {
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
