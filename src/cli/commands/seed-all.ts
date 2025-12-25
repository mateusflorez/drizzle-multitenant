import { Command } from 'commander';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMigrator } from '../../migrator/migrator.js';
import type { SeedFunction, SharedSeedFunction } from '../../migrator/types.js';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  createProgressBar,
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

interface SeedAllOptions {
  config?: string;
  sharedFile: string;
  tenantFile: string;
  concurrency?: string;
}

interface SeedAllJsonOutput {
  shared: {
    schema: string;
    success: boolean;
    durationMs: number;
    error?: string;
  };
  tenants: {
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
    };
  };
  totalDurationMs: number;
}

export const seedAllCommand = new Command('seed-all')
  .description('Seed shared schema first, then all tenants')
  .requiredOption('--shared-file <path>', 'Path to shared schema seed file')
  .requiredOption('--tenant-file <path>', 'Path to tenant seed file')
  .option('-c, --config <path>', 'Path to config file')
  .option('--concurrency <number>', 'Number of concurrent tenant seed operations', '10')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant seed-all \\
      --shared-file=./seeds/shared/plans.ts \\
      --tenant-file=./seeds/tenant/initial.ts

  $ drizzle-multitenant seed-all \\
      --shared-file=./seeds/shared/plans.ts \\
      --tenant-file=./seeds/tenant/initial.ts \\
      --concurrency=5

Seed File Formats:
  // seeds/shared/plans.ts
  import { SharedSeedFunction } from 'drizzle-multitenant';

  export const seed: SharedSeedFunction = async (db) => {
    await db.insert(plans).values([...]).onConflictDoNothing();
  };

  // seeds/tenant/initial.ts
  import { SeedFunction } from 'drizzle-multitenant';

  export const seed: SeedFunction = async (db, tenantId) => {
    await db.insert(roles).values([...]);
  };
`)
  .action(async (options: SeedAllOptions) => {
    const startTime = Date.now();
    const ctx = getOutputContext();
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, migrationsTable, tenantDiscovery } = await loadConfig(options.config);

      if (!tenantDiscovery) {
        spinner.fail('Tenant discovery not configured');
        log(`\n${warning('The tenantDiscovery function is not configured in your config file.')}`);
        process.exit(1);
      }

      const folder = resolveMigrationsFolder(migrationsFolder);

      debug(`Using migrations folder: ${folder}`);

      // Check if shared schema is configured
      if (!config.schemas?.shared) {
        spinner.fail('Shared schema not configured');
        log(`\n${warning('The shared schema (schemas.shared) is not configured.')}`);
        process.exit(1);
      }

      // Load the shared seed file
      spinner.text = 'Loading shared seed file...';
      const sharedSeedFilePath = resolve(process.cwd(), options.sharedFile);
      const sharedSeedFileUrl = pathToFileURL(sharedSeedFilePath).href;

      let sharedSeedFn: SharedSeedFunction;

      try {
        const sharedSeedModule = await import(sharedSeedFileUrl);
        sharedSeedFn = sharedSeedModule.seed || sharedSeedModule.default;

        if (typeof sharedSeedFn !== 'function') {
          throw new Error('Shared seed file must export a "seed" function or default export');
        }
      } catch (err) {
        spinner.fail('Failed to load shared seed file');
        const loadError = err as Error;
        if (loadError.message.includes('Cannot find module')) {
          log(`\n${warning(`Shared seed file not found: ${sharedSeedFilePath}`)}`);
        } else {
          log(`\n${warning(loadError.message)}`);
        }
        process.exit(1);
      }

      // Load the tenant seed file
      spinner.text = 'Loading tenant seed file...';
      const tenantSeedFilePath = resolve(process.cwd(), options.tenantFile);
      const tenantSeedFileUrl = pathToFileURL(tenantSeedFilePath).href;

      let tenantSeedFn: SeedFunction;

      try {
        const tenantSeedModule = await import(tenantSeedFileUrl);
        tenantSeedFn = tenantSeedModule.seed || tenantSeedModule.default;

        if (typeof tenantSeedFn !== 'function') {
          throw new Error('Tenant seed file must export a "seed" function or default export');
        }
      } catch (err) {
        spinner.fail('Failed to load tenant seed file');
        const loadError = err as Error;
        if (loadError.message.includes('Cannot find module')) {
          log(`\n${warning(`Tenant seed file not found: ${tenantSeedFilePath}`)}`);
        } else {
          log(`\n${warning(loadError.message)}`);
        }
        process.exit(1);
      }

      // Discover tenants
      spinner.text = 'Discovering tenants...';
      const tenantIds = await tenantDiscovery();

      if (tenantIds.length === 0) {
        spinner.stop();
        log(warning('No tenants found.'));
        return;
      }

      spinner.text = `Found ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}`;
      spinner.succeed();

      const migrator = createMigrator(config, {
        migrationsFolder: folder,
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery,
      });

      const concurrency = parseInt(options.concurrency || '10', 10);

      // Step 1: Seed shared schema
      log(bold('\n[1/2] Seeding shared schema...'));
      const sharedSpinner = createSpinner('Seeding shared schema...');
      sharedSpinner.start();

      const sharedResult = await migrator.seedShared(sharedSeedFn as any);

      if (sharedResult.success) {
        sharedSpinner.succeed(`Shared schema seeded in ${sharedResult.durationMs}ms`);
      } else {
        sharedSpinner.fail(`Failed to seed shared schema: ${sharedResult.error}`);
        if (!ctx.jsonMode) {
          process.exit(1);
        }
      }

      // Step 2: Seed all tenants
      log(bold(`\n[2/2] Seeding ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}...`));

      const progressBar = createProgressBar({ total: tenantIds.length });
      progressBar.start();

      const tenantsResult = await migrator.seedAll(tenantSeedFn as any, {
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
        const jsonOutput: SeedAllJsonOutput = {
          shared: {
            schema: sharedResult.schemaName,
            success: sharedResult.success,
            durationMs: sharedResult.durationMs,
            error: sharedResult.error,
          },
          tenants: {
            results: tenantsResult.details.map(r => ({
              tenantId: r.tenantId,
              schema: r.schemaName,
              success: r.success,
              durationMs: r.durationMs,
              error: r.error,
            })),
            summary: {
              total: tenantsResult.total,
              succeeded: tenantsResult.succeeded,
              failed: tenantsResult.failed,
              skipped: tenantsResult.skipped,
            },
          },
          totalDurationMs: totalDuration,
        };
        outputJson(jsonOutput);
        process.exit(sharedResult.success && tenantsResult.failed === 0 ? 0 : 1);
      }

      // Human-readable output
      log('\n' + bold('Summary:'));
      log(bold('  Shared:'));
      log(`    Schema:     ${sharedResult.schemaName}`);
      log(`    Status:     ${sharedResult.success ? success('success') : error('failed')}`);
      log(`    Duration:   ${dim(formatDuration(sharedResult.durationMs))}`);

      log(bold('\n  Tenants:'));
      log(`    Total:      ${tenantsResult.total}`);
      log(`    Succeeded:  ${success(tenantsResult.succeeded.toString())}`);
      if (tenantsResult.failed > 0) {
        log(`    Failed:     ${error(tenantsResult.failed.toString())}`);
      }
      if (tenantsResult.skipped > 0) {
        log(`    Skipped:    ${warning(tenantsResult.skipped.toString())}`);
      }

      log(bold('\n  Total:'));
      log(`    Duration:   ${dim(formatDuration(totalDuration))}`);

      // Show failed tenants summary
      if (tenantsResult.failed > 0) {
        log('\n' + bold('Failed tenants:'));
        for (const detail of tenantsResult.details.filter(d => !d.success)) {
          log(`  ${error(detail.tenantId)}: ${dim(detail.error || 'Unknown error')}`);
        }
      }

      if (!sharedResult.success || tenantsResult.failed > 0) {
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
