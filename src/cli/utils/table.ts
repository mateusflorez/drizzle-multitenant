import Table from 'cli-table3';
import chalk from 'chalk';
import type { TenantMigrationStatus } from '../../migrator/types.js';

/**
 * Create a status table for tenant migrations
 */
export function createStatusTable(statuses: TenantMigrationStatus[]): string {
  const table = new Table({
    head: [
      chalk.cyan('Tenant'),
      chalk.cyan('Schema'),
      chalk.cyan('Applied'),
      chalk.cyan('Pending'),
      chalk.cyan('Status'),
    ],
    style: {
      head: [],
      border: [],
    },
  });

  for (const status of statuses) {
    const statusIcon = getStatusIcon(status.status);
    const statusText = getStatusText(status.status);

    table.push([
      status.tenantId,
      chalk.dim(status.schemaName),
      chalk.green(status.appliedCount.toString()),
      status.pendingCount > 0
        ? chalk.yellow(status.pendingCount.toString())
        : chalk.dim('0'),
      `${statusIcon} ${statusText}`,
    ]);
  }

  return table.toString();
}

/**
 * Create a results table for migration execution
 */
export function createResultsTable(
  results: Array<{
    tenantId: string;
    schemaName: string;
    success: boolean;
    appliedMigrations: string[];
    error?: string;
    durationMs: number;
  }>
): string {
  const table = new Table({
    head: [
      chalk.cyan('Tenant'),
      chalk.cyan('Migrations'),
      chalk.cyan('Duration'),
      chalk.cyan('Status'),
    ],
    style: {
      head: [],
      border: [],
    },
  });

  for (const result of results) {
    const statusIcon = result.success ? chalk.green('✓') : chalk.red('✗');
    const statusText = result.success
      ? chalk.green('OK')
      : chalk.red(result.error ?? 'Failed');

    table.push([
      result.tenantId,
      result.appliedMigrations.length.toString(),
      `${result.durationMs}ms`,
      `${statusIcon} ${statusText}`,
    ]);
  }

  return table.toString();
}

/**
 * Create a pending migrations summary
 */
export function createPendingSummary(statuses: TenantMigrationStatus[]): string {
  const pendingMap = new Map<string, number>();

  for (const status of statuses) {
    for (const migration of status.pendingMigrations) {
      pendingMap.set(migration, (pendingMap.get(migration) || 0) + 1);
    }
  }

  if (pendingMap.size === 0) {
    return chalk.green('\nAll tenants are up to date.');
  }

  const lines = [chalk.yellow('\nPending migrations:')];

  for (const [migration, count] of pendingMap.entries()) {
    lines.push(
      `  ${chalk.dim('-')} ${migration} ${chalk.dim(`(${count} tenant${count > 1 ? 's' : ''})`)}`
    );
  }

  lines.push(
    chalk.dim('\nRun \'drizzle-multitenant migrate --all\' to apply pending migrations.')
  );

  return lines.join('\n');
}

/**
 * Get status icon
 */
function getStatusIcon(status: 'ok' | 'behind' | 'error'): string {
  switch (status) {
    case 'ok':
      return chalk.green('✓');
    case 'behind':
      return chalk.yellow('⚠');
    case 'error':
      return chalk.red('✗');
  }
}

/**
 * Get status text
 */
function getStatusText(status: 'ok' | 'behind' | 'error'): string {
  switch (status) {
    case 'ok':
      return chalk.green('OK');
    case 'behind':
      return chalk.yellow('Behind');
    case 'error':
      return chalk.red('Error');
  }
}
