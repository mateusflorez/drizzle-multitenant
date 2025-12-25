import { Command } from 'commander';
import { checkbox } from '@inquirer/prompts';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMigrator } from '../../migrator/migrator.js';
import type { SeedFunction } from '../../migrator/types.js';
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
  shouldShowInteractive,
} from '../utils/index.js';

interface SeedOptions {
  config?: string;
  file: string;
  all?: boolean;
  tenant?: string;
  tenants?: string;
  concurrency?: string;
}

interface SeedJsonOutput {
  results: Array<{
    tenantId: string;
    schema: string;
    success: boolean;
    durationMs: number;
    error?: string;
  }>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    durationMs: number;
  };
}

export const seedCommand = new Command('seed')
  .description('Seed tenant databases with initial data')
  .requiredOption('-f, --file <path>', 'Path to seed file (TypeScript or JavaScript)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-a, --all', 'Seed all tenants')
  .option('-t, --tenant <id>', 'Seed a specific tenant')
  .option('--tenants <ids>', 'Seed specific tenants (comma-separated)')
  .option('--concurrency <number>', 'Number of concurrent seed operations', '10')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant seed --file=./seeds/initial.ts --all
  $ drizzle-multitenant seed --file=./seeds/initial.ts --tenant=my-tenant
  $ drizzle-multitenant seed --file=./seeds/initial.ts --tenants=tenant-1,tenant-2
  $ drizzle-multitenant seed --file=./seeds/initial.ts --all --concurrency=5

Seed File Format:
  // seeds/initial.ts
  import { SeedFunction } from 'drizzle-multitenant';

  export const seed: SeedFunction = async (db, tenantId) => {
    await db.insert(roles).values([
      { name: 'admin', permissions: ['*'] },
      { name: 'user', permissions: ['read'] },
    ]);
  };
`)
  .action(async (options: SeedOptions) => {
    const startTime = Date.now();
    const ctx = getOutputContext();
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, migrationsTable, tenantDiscovery } = await loadConfig(options.config);

      const folder = resolveMigrationsFolder(migrationsFolder);

      debug(`Using migrations folder: ${folder}`);

      // Load the seed file
      spinner.text = 'Loading seed file...';
      const seedFilePath = resolve(process.cwd(), options.file);
      const seedFileUrl = pathToFileURL(seedFilePath).href;

      let seedFn: SeedFunction;

      try {
        const seedModule = await import(seedFileUrl);
        seedFn = seedModule.seed || seedModule.default;

        if (typeof seedFn !== 'function') {
          throw new Error('Seed file must export a "seed" function or default export');
        }
      } catch (err) {
        spinner.fail('Failed to load seed file');
        const error = err as Error;
        if (error.message.includes('Cannot find module')) {
          log(`\n${warning(`Seed file not found: ${seedFilePath}`)}`);
          log(dim('\nMake sure the file exists and has the correct format:'));
          log(dim('  export const seed: SeedFunction = async (db, tenantId) => { ... };'));
        } else {
          log(`\n${warning(error.message)}`);
        }
        process.exit(1);
      }

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
            message: 'Select tenants to seed:',
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

      log(info(`Seeding ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}...\n`));

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery: discoveryFn,
      });

      const concurrency = parseInt(options.concurrency || '10', 10);

      // Use progress bar for interactive mode
      const progressBar = createProgressBar({ total: tenantIds.length });
      progressBar.start();

      const results = await migrator.seedAll(seedFn as any, {
        concurrency,
        onProgress: (tenantId: string, status: string) => {
          if (status === 'completed') {
            progressBar.increment({ tenant: tenantId, status: 'success' });
            debug(`Completed: ${tenantId}`);
          } else if (status === 'failed') {
            progressBar.increment({ tenant: tenantId, status: 'error' });
            debug(`Failed: ${tenantId}`);
          }
        },
        onError: (tenantId: string, err: Error) => {
          debug(`Error on ${tenantId}: ${err.message}`);
          return 'continue' as const;
        },
      });

      progressBar.stop();

      const totalDuration = Date.now() - startTime;

      // JSON output
      if (ctx.jsonMode) {
        const jsonOutput: SeedJsonOutput = {
          results: results.details.map(r => ({
            tenantId: r.tenantId,
            schema: r.schemaName,
            success: r.success,
            durationMs: r.durationMs,
            error: r.error,
          })),
          summary: {
            total: results.total,
            succeeded: results.succeeded,
            failed: results.failed,
            skipped: results.skipped,
            durationMs: totalDuration,
          },
        };
        outputJson(jsonOutput);
        process.exit(results.failed > 0 ? 1 : 0);
      }

      // Human-readable output
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
