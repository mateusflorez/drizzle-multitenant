import { Command } from 'commander';
import { createMigrator } from '../../migrator/migrator.js';
import {
  loadConfig,
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
} from '../utils/index.js';
import type { DiffOptions, DiffJsonOutput, DiffTenantInfo } from '../types.js';

export const diffCommand = new Command('diff')
  .description('Detect schema drift between tenant schemas')
  .option('-c, --config <path>', 'Path to config file')
  .option('-r, --reference <tenant>', 'Tenant ID to use as reference (default: first tenant)')
  .option('-t, --tenant <tenant>', 'Check only this tenant against reference')
  .option('--tenants <tenants>', 'Check only these tenants (comma-separated)')
  .option('--concurrency <number>', 'Number of concurrent operations', '10')
  .option('--no-indexes', 'Skip index comparison')
  .option('--no-constraints', 'Skip constraint comparison')
  .option('--exclude-tables <tables>', 'Tables to exclude from comparison (comma-separated)')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant diff
  $ drizzle-multitenant diff --reference=tenant-1
  $ drizzle-multitenant diff --tenant=tenant-2 --reference=tenant-1
  $ drizzle-multitenant diff --tenants=tenant-2,tenant-3
  $ drizzle-multitenant diff --no-indexes --no-constraints
  $ drizzle-multitenant diff --exclude-tables=logs,audit
  $ drizzle-multitenant diff --json
`)
  .action(async (options: DiffOptions) => {
    const startTime = Date.now();
    const ctx = getOutputContext();
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { config, migrationsFolder, migrationsTable, tenantDiscovery } = await loadConfig(options.config);

      if (!tenantDiscovery) {
        throw CLIErrors.noTenantDiscovery();
      }

      debug(`Using config from: ${options.config || 'default location'}`);

      const migrator = createMigrator(config, {
        migrationsFolder: migrationsFolder ?? './drizzle',
        ...(migrationsTable && { migrationsTable }),
        tenantDiscovery,
      });

      // Parse options
      const concurrency = parseInt(options.concurrency || '10', 10);
      const includeIndexes = options.indexes !== false;
      const includeConstraints = options.constraints !== false;
      const excludeTables = options.excludeTables
        ? options.excludeTables.split(',').map((t) => t.trim())
        : [];

      // Determine tenant IDs to check
      let tenantIds: string[] | undefined;
      if (options.tenant) {
        tenantIds = [options.tenant];
      } else if (options.tenants) {
        tenantIds = options.tenants.split(',').map((t) => t.trim());
      }

      spinner.text = 'Detecting schema drift...';

      // Get all tenants if checking specific ones
      const allTenants = await tenantDiscovery();
      const tenantsToCheck = tenantIds ?? allTenants;

      if (tenantsToCheck.length === 0) {
        spinner.fail('No tenants found');
        return;
      }

      spinner.succeed(`Found ${allTenants.length} tenant${allTenants.length > 1 ? 's' : ''}`);

      // Determine reference tenant
      const referenceTenant = options.reference ?? tenantsToCheck[0];

      log(info(`\nUsing "${referenceTenant}" as reference tenant\n`));

      // Create progress bar
      const progressBar = createProgressBar({ total: tenantsToCheck.length });
      progressBar.start();

      const driftStatus = await migrator.getSchemaDrift({
        referenceTenant,
        tenantIds: tenantsToCheck,
        concurrency,
        includeIndexes,
        includeConstraints,
        excludeTables,
        onProgress: (tenantId, status) => {
          if (status === 'completed') {
            progressBar.increment({ tenant: tenantId, status: 'success' });
          } else if (status === 'failed') {
            progressBar.increment({ tenant: tenantId, status: 'error' });
          }
        },
      });

      progressBar.stop();

      const totalDuration = Date.now() - startTime;

      // JSON output
      if (ctx.jsonMode) {
        const jsonOutput: DiffJsonOutput = {
          referenceTenant: driftStatus.referenceTenant,
          tenants: driftStatus.details.map((d) => ({
            id: d.tenantId,
            schema: d.schemaName,
            hasDrift: d.hasDrift,
            issueCount: d.issueCount,
            tables: d.tables.map((t) => ({
              name: t.table,
              status: t.status,
              columns: t.columns,
              indexes: t.indexes,
              constraints: t.constraints,
            })),
            error: d.error,
          })),
          summary: {
            total: driftStatus.total,
            noDrift: driftStatus.noDrift,
            withDrift: driftStatus.withDrift,
            error: driftStatus.error,
            durationMs: totalDuration,
          },
        };
        outputJson(jsonOutput);
        process.exit(driftStatus.withDrift > 0 ? 1 : 0);
      }

      // Human-readable output
      log('\n' + bold('Schema Drift Status:'));
      log(createDriftStatusTable(driftStatus.details, driftStatus.referenceTenant));
      log(createDriftSummary(driftStatus, totalDuration));

      // Show detailed drift information for tenants with issues
      const tenantsWithDrift = driftStatus.details.filter((d) => d.hasDrift);
      if (tenantsWithDrift.length > 0) {
        log('\n' + bold('Drift Details:'));
        for (const tenant of tenantsWithDrift) {
          log(`\n  ${warning(tenant.tenantId)} (${tenant.schemaName}):`);
          for (const table of tenant.tables) {
            if (table.status === 'missing') {
              log(`    ${error('✗')} Table "${table.table}" is missing`);
            } else if (table.status === 'extra') {
              log(`    ${warning('+')} Table "${table.table}" is extra (not in reference)`);
            } else if (table.status === 'drifted') {
              log(`    ${warning('~')} Table "${table.table}":`);
              for (const col of table.columns) {
                const icon = col.type === 'missing' ? error('✗') : col.type === 'extra' ? warning('+') : warning('~');
                log(`      ${icon} ${col.description}`);
              }
              for (const idx of table.indexes) {
                const icon = idx.type === 'missing' ? error('✗') : idx.type === 'extra' ? warning('+') : warning('~');
                log(`      ${icon} ${idx.description}`);
              }
              for (const con of table.constraints) {
                const icon = con.type === 'missing' ? error('✗') : con.type === 'extra' ? warning('+') : warning('~');
                log(`      ${icon} ${con.description}`);
              }
            }
          }
        }
      }

      process.exit(driftStatus.withDrift > 0 ? 1 : 0);
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

/**
 * Create a table showing drift status
 */
function createDriftStatusTable(
  details: Array<{
    tenantId: string;
    schemaName: string;
    hasDrift: boolean;
    issueCount: number;
    error?: string;
  }>,
  referenceTenant: string
): string {
  if (details.length === 0) {
    return '  No tenants found.\n';
  }

  const lines: string[] = [];

  for (const detail of details) {
    const isReference = detail.tenantId === referenceTenant;
    const prefix = isReference ? dim('(ref) ') : '';

    if (detail.error) {
      lines.push(`  ${error(detail.tenantId)}: ${prefix}${dim(detail.error)}`);
    } else if (detail.hasDrift) {
      lines.push(`  ${warning(detail.tenantId)}: ${prefix}${detail.issueCount} issue${detail.issueCount > 1 ? 's' : ''} detected`);
    } else {
      lines.push(`  ${success(detail.tenantId)}: ${prefix}${dim('No drift')}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Create a summary of drift status
 */
function createDriftSummary(
  status: {
    total: number;
    noDrift: number;
    withDrift: number;
    error: number;
  },
  durationMs: number
): string {
  const lines: string[] = [];

  lines.push('\n' + bold('Summary:'));
  lines.push(`  Total:      ${status.total}`);
  lines.push(`  No Drift:   ${success(status.noDrift.toString())}`);
  if (status.withDrift > 0) {
    lines.push(`  With Drift: ${warning(status.withDrift.toString())}`);
  }
  if (status.error > 0) {
    lines.push(`  Errors:     ${error(status.error.toString())}`);
  }
  lines.push(`  Duration:   ${dim(formatDuration(durationMs))}`);

  if (status.withDrift > 0) {
    lines.push('\n' + dim('Run migrations to fix drift: drizzle-multitenant migrate --all'));
  }

  return lines.join('\n');
}
