import { checkbox, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { createMigrator } from '../../../migrator/migrator.js';
import { MenuRenderer } from '../base/menu-renderer.js';
import type { MenuContext, TenantMigrationStatus, ScreenAction } from '../types.js';

/**
 * Screen for running migrations on tenants
 */
export class MigrationsScreen {
  private readonly renderer: MenuRenderer;

  constructor(
    private readonly ctx: MenuContext,
    renderer?: MenuRenderer
  ) {
    this.renderer = renderer || new MenuRenderer();
  }

  /**
   * Show migration selection screen
   */
  async show(statuses: TenantMigrationStatus[]): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Migrate Tenants');

    const pendingTenants = statuses.filter((s) => s.pendingCount > 0);

    if (pendingTenants.length === 0) {
      this.renderer.showStatus('All tenants are up to date', 'success');
      await this.renderer.pressEnterToContinue();
      return { type: 'back' };
    }

    console.log(chalk.dim(`  Found ${pendingTenants.length} tenant(s) with pending migrations\n`));

    const selectedTenants = await checkbox({
      message: 'Select tenants to migrate:',
      choices: pendingTenants.map((s) => ({
        name: `${s.tenantId} ${chalk.yellow(`(${s.pendingCount} pending)`)}`,
        value: s.tenantId,
        checked: true,
      })),
      pageSize: 15,
    });

    if (selectedTenants.length === 0) {
      this.renderer.showStatus('No tenants selected', 'warning');
      await this.renderer.pressEnterToContinue();
      return { type: 'back' };
    }

    const confirmMigrate = await confirm({
      message: `Migrate ${selectedTenants.length} tenant(s)?`,
      default: true,
    });

    if (!confirmMigrate) {
      return { type: 'back' };
    }

    await this.runMigration(selectedTenants);
    return { type: 'refresh' };
  }

  /**
   * Run migrations for a single tenant
   */
  async migrateSingle(tenantId: string): Promise<ScreenAction> {
    await this.runMigration([tenantId]);
    return { type: 'refresh' };
  }

  /**
   * Run migrations for selected tenants
   */
  async runMigration(tenantIds: string[]): Promise<void> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Running Migrations');

    const migrator = createMigrator(this.ctx.config, {
      migrationsFolder: this.ctx.migrationsFolder,
      ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
      tenantDiscovery: async () => tenantIds,
    });

    const startTime = Date.now();
    console.log(chalk.dim(`  Migrating ${tenantIds.length} tenant(s)...\n`));

    const results = await migrator.migrateAll({
      concurrency: 10,
      onProgress: (_tenantId, status, migrationName) => {
        if (status === 'completed' || status === 'failed' || status === 'migrating') {
          this.renderer.showProgress(_tenantId, status, migrationName);
        }
      },
      onError: (_tenantId, error) => {
        this.renderer.showError(error.message);
        return 'continue';
      },
    });

    const duration = Date.now() - startTime;
    this.renderer.showResults(results, duration);

    console.log('');
    await this.renderer.pressEnterToContinue();
  }
}
