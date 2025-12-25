import { select } from '@inquirer/prompts';
import chalk from 'chalk';
import { MenuRenderer } from '../base/menu-renderer.js';
import type { MenuContext, TenantMigrationStatus, ScreenAction } from '../types.js';

/**
 * Screen for displaying migration status and tenant details
 */
export class StatusScreen {
  private readonly renderer: MenuRenderer;

  constructor(
    _ctx: MenuContext,
    renderer?: MenuRenderer
  ) {
    this.renderer = renderer || new MenuRenderer();
  }

  /**
   * Show the status overview screen
   */
  async show(statuses: TenantMigrationStatus[]): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Migration Status');

    if (statuses.length === 0) {
      this.renderer.showStatus('No tenants found', 'warning');
      await this.renderer.pressEnterToContinue();
      return { type: 'back' };
    }

    // Create and display status table
    const table = this.renderer.createStatusTable(statuses);
    console.log(table.toString());

    // Show summary
    this.renderer.showSummary(statuses);

    // Show pending migrations
    this.renderer.showPendingMigrations(statuses);

    console.log('');

    const summary = this.renderer.getStatusSummary(statuses);

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Migrate all pending', value: 'migrate', disabled: summary.totalPending === 0 },
        { name: 'View tenant details', value: 'details' },
        { name: chalk.gray('← Back to main menu'), value: 'back' },
      ],
    });

    if (action === 'migrate') {
      return { type: 'navigate', screen: 'migrate', params: { statuses } };
    } else if (action === 'details') {
      return this.showTenantSelection(statuses);
    }

    return { type: 'back' };
  }

  /**
   * Show tenant selection for details view
   */
  private async showTenantSelection(statuses: TenantMigrationStatus[]): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Select Tenant');

    const choices = statuses.map((s) => ({
      name: `${this.renderer.formatTenantStatus(s.status).split(' ')[0]} ${s.tenantId} ${chalk.dim(`(${s.schemaName})`)}`,
      value: s.tenantId,
    }));
    choices.push({ name: chalk.gray('← Back'), value: 'back' });

    const selected = await select({
      message: 'Select a tenant to view details:',
      choices,
    });

    if (selected === 'back') {
      return this.show(statuses);
    }

    const status = statuses.find((s) => s.tenantId === selected);
    if (!status) {
      return this.show(statuses);
    }

    return this.showTenantDetails(status, statuses);
  }

  /**
   * Show detailed information for a specific tenant
   */
  async showTenantDetails(
    status: TenantMigrationStatus,
    allStatuses: TenantMigrationStatus[]
  ): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader(`Tenant: ${status.tenantId}`);

    console.log(chalk.bold('  Details:'));
    console.log(`    Schema:           ${status.schemaName}`);
    console.log(`    Format:           ${status.format || chalk.dim('(new)')}`);
    console.log(`    Applied:          ${chalk.green(status.appliedCount.toString())}`);
    console.log(`    Pending:          ${this.renderer.formatPendingCount(status.pendingCount)}`);
    console.log(`    Status:           ${this.renderer.formatTenantStatus(status.status)}`);

    if (status.pendingMigrations.length > 0) {
      console.log('');
      console.log(chalk.yellow('  Pending migrations:'));
      for (const migration of status.pendingMigrations) {
        console.log(`    ${chalk.dim('-')} ${migration}`);
      }
    }

    if (status.error) {
      console.log('');
      console.log(chalk.red(`  Error: ${status.error}`));
    }

    console.log('');

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        {
          name: 'Migrate this tenant',
          value: 'migrate',
          disabled: status.pendingCount === 0,
        },
        { name: chalk.gray('← Back to list'), value: 'back' },
      ],
    });

    if (action === 'migrate') {
      return {
        type: 'navigate',
        screen: 'migrate-single',
        params: { tenantId: status.tenantId },
      };
    }

    return this.showTenantSelection(allStatuses);
  }
}
