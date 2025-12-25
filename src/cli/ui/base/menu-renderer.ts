import chalk from 'chalk';
import Table from 'cli-table3';
import { select } from '@inquirer/prompts';
import type { TenantMigrationStatus, StatusSummary } from '../types.js';

/**
 * Base renderer for menu screens
 * Handles common UI operations like headers, tables, and status messages
 */
export class MenuRenderer {
  /**
   * Clear the terminal screen
   */
  clearScreen(): void {
    console.clear();
  }

  /**
   * Show a section header with underline
   */
  showHeader(title: string): void {
    console.log('');
    console.log(chalk.cyan.bold(`  ${title}`));
    console.log(chalk.dim('  ' + '─'.repeat(title.length + 4)));
    console.log('');
  }

  /**
   * Show status message with icon
   */
  showStatus(
    message: string,
    type: 'success' | 'warning' | 'error' | 'info' = 'info'
  ): void {
    const icons = {
      success: chalk.green('✓'),
      warning: chalk.yellow('⚠'),
      error: chalk.red('✗'),
      info: chalk.blue('ℹ'),
    };

    const colors = {
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      info: chalk.blue,
    };

    console.log(`\n  ${icons[type]} ${colors[type](message)}\n`);
  }

  /**
   * Format tenant status for display
   */
  formatTenantStatus(status: 'ok' | 'behind' | 'error'): string {
    switch (status) {
      case 'ok':
        return chalk.green('● up to date');
      case 'behind':
        return chalk.yellow('● pending');
      case 'error':
        return chalk.red('● error');
    }
  }

  /**
   * Format pending count for display
   */
  formatPendingCount(count: number): string {
    if (count === 0) {
      return chalk.dim('0');
    }
    return chalk.yellow(`${count} pending`);
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(ms: number): string {
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
   * Create a status table for tenant display
   */
  createStatusTable(statuses: TenantMigrationStatus[]): Table.Table {
    const table = new Table({
      head: [
        chalk.cyan('Tenant'),
        chalk.cyan('Schema'),
        chalk.cyan('Applied'),
        chalk.cyan('Pending'),
        chalk.cyan('Status'),
      ],
      style: { head: [], border: [] },
    });

    for (const status of statuses) {
      table.push([
        status.tenantId,
        chalk.dim(status.schemaName),
        chalk.green(status.appliedCount.toString()),
        this.formatPendingCount(status.pendingCount),
        this.formatTenantStatus(status.status),
      ]);
    }

    return table;
  }

  /**
   * Calculate status summary from tenant statuses
   */
  getStatusSummary(statuses: TenantMigrationStatus[]): StatusSummary {
    const upToDate = statuses.filter((s) => s.status === 'ok').length;
    const behind = statuses.filter((s) => s.status === 'behind').length;
    const error = statuses.filter((s) => s.status === 'error').length;
    const totalPending = statuses.reduce((sum, s) => sum + s.pendingCount, 0);

    return { upToDate, behind, error, totalPending };
  }

  /**
   * Show summary statistics
   */
  showSummary(statuses: TenantMigrationStatus[]): void {
    const summary = this.getStatusSummary(statuses);

    console.log('');
    console.log(chalk.bold('  Summary:'));
    console.log(`    Total tenants: ${statuses.length}`);
    console.log(`    Up to date:    ${chalk.green(summary.upToDate.toString())}`);
    if (summary.behind > 0) {
      console.log(`    Behind:        ${chalk.yellow(summary.behind.toString())}`);
    }
    if (summary.error > 0) {
      console.log(`    Errors:        ${chalk.red(summary.error.toString())}`);
    }
  }

  /**
   * Show pending migrations grouped by migration name
   */
  showPendingMigrations(statuses: TenantMigrationStatus[]): void {
    const pendingMap = new Map<string, number>();
    for (const status of statuses) {
      for (const migration of status.pendingMigrations) {
        pendingMap.set(migration, (pendingMap.get(migration) || 0) + 1);
      }
    }

    if (pendingMap.size > 0) {
      console.log('');
      console.log(chalk.yellow('  Pending migrations:'));
      for (const [migration, count] of pendingMap.entries()) {
        console.log(
          `    ${chalk.dim('-')} ${migration} ${chalk.dim(`(${count} tenant${count > 1 ? 's' : ''})`)}`
        );
      }
    }
  }

  /**
   * Show migration results
   */
  showResults(results: { succeeded: number; failed: number; details: Array<{ tenantId: string; success: boolean; error?: string }> }, duration: number): void {
    console.log('');
    console.log(chalk.bold('  Results:'));
    console.log(`    Succeeded: ${chalk.green(results.succeeded.toString())}`);
    if (results.failed > 0) {
      console.log(`    Failed:    ${chalk.red(results.failed.toString())}`);
    }
    console.log(`    Duration:  ${chalk.dim(this.formatDuration(duration))}`);

    if (results.failed > 0) {
      console.log('');
      console.log(chalk.red('  Failed tenants:'));
      for (const detail of results.details.filter((d) => !d.success)) {
        console.log(`    ${chalk.red('✗')} ${detail.tenantId}: ${chalk.dim(detail.error || 'Unknown error')}`);
      }
    }
  }

  /**
   * Wait for user to press Enter to continue
   */
  async pressEnterToContinue(): Promise<void> {
    await select({
      message: 'Press Enter to continue...',
      choices: [{ name: 'Continue', value: 'continue' }],
    });
  }

  /**
   * Show progress for a tenant operation
   */
  showProgress(tenantId: string, status: 'completed' | 'failed' | 'migrating', migrationName?: string): void {
    if (status === 'completed') {
      console.log(chalk.green(`  ✓ ${tenantId}`));
    } else if (status === 'failed') {
      console.log(chalk.red(`  ✗ ${tenantId}`));
    } else if (status === 'migrating' && migrationName) {
      console.log(chalk.dim(`    Applying: ${migrationName}`));
    }
  }

  /**
   * Show error message
   */
  showError(message: string): void {
    console.log(chalk.red(`    Error: ${message}`));
  }
}
