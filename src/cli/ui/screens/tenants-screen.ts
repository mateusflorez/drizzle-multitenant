import { select, confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { createMigrator } from '../../../migrator/migrator.js';
import { MenuRenderer } from '../base/menu-renderer.js';
import type { MenuContext, TenantMigrationStatus, ScreenAction } from '../types.js';

/**
 * Screen for creating and dropping tenants
 */
export class TenantsScreen {
  private readonly renderer: MenuRenderer;

  constructor(
    private readonly ctx: MenuContext,
    renderer?: MenuRenderer
  ) {
    this.renderer = renderer || new MenuRenderer();
  }

  /**
   * Show create tenant screen
   */
  async showCreate(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Create Tenant');

    const tenantId = await input({
      message: 'Tenant ID:',
      validate: (value) => {
        if (!value.trim()) return 'Tenant ID cannot be empty';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {
          return 'Invalid tenant ID format (use alphanumeric, dashes, underscores)';
        }
        return true;
      },
    });

    const schemaName = this.ctx.config.isolation.schemaNameTemplate(tenantId);

    console.log(chalk.dim(`\n  Schema name: ${schemaName}`));

    const applyMigrations = await confirm({
      message: 'Apply all migrations after creation?',
      default: true,
    });

    const confirmCreate = await confirm({
      message: `Create tenant "${tenantId}"?`,
      default: true,
    });

    if (!confirmCreate) {
      return { type: 'back' };
    }

    const spinner = ora('Creating tenant...').start();

    try {
      const migrator = createMigrator(this.ctx.config, {
        migrationsFolder: this.ctx.migrationsFolder,
        ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
        tenantDiscovery: async () => [],
      });

      // Check if tenant exists
      const exists = await migrator.tenantExists(tenantId);
      if (exists) {
        spinner.warn(`Tenant ${tenantId} already exists`);
        await this.renderer.pressEnterToContinue();
        return { type: 'back' };
      }

      // Create tenant
      await migrator.createTenant(tenantId, { migrate: applyMigrations });

      spinner.succeed(`Tenant ${tenantId} created successfully`);

      console.log('');
      console.log(chalk.green('  ✓ Schema created: ') + chalk.dim(schemaName));
      if (applyMigrations) {
        console.log(chalk.green('  ✓ All migrations applied'));
      }

      console.log(chalk.dim('\n  Usage:'));
      console.log(chalk.dim(`    const db = tenants.getDb('${tenantId}');`));
    } catch (error) {
      spinner.fail('Failed to create tenant');
      console.log(chalk.red(`\n  ${(error as Error).message}`));
    }

    console.log('');
    await this.renderer.pressEnterToContinue();
    return { type: 'refresh' };
  }

  /**
   * Show drop tenant screen
   */
  async showDrop(statuses: TenantMigrationStatus[]): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Drop Tenant');

    if (statuses.length === 0) {
      this.renderer.showStatus('No tenants found', 'warning');
      await this.renderer.pressEnterToContinue();
      return { type: 'back' };
    }

    const choices = statuses.map((s) => ({
      name: `${s.tenantId} ${chalk.dim(`(${s.schemaName})`)}`,
      value: s.tenantId,
    }));
    choices.push({ name: chalk.gray('← Cancel'), value: 'cancel' });

    const selected = await select({
      message: 'Select tenant to drop:',
      choices,
    });

    if (selected === 'cancel') {
      return { type: 'back' };
    }

    const status = statuses.find((s) => s.tenantId === selected);
    if (!status) {
      return { type: 'back' };
    }

    console.log('');
    console.log(chalk.red.bold('  WARNING: This action is irreversible!'));
    console.log(chalk.dim(`  Schema ${status.schemaName} and all its data will be deleted.`));
    console.log('');

    const confirmDrop = await confirm({
      message: `Are you sure you want to drop tenant "${selected}"?`,
      default: false,
    });

    if (!confirmDrop) {
      return { type: 'back' };
    }

    // Double confirmation
    const confirmAgain = await input({
      message: `Type "${selected}" to confirm deletion:`,
    });

    if (confirmAgain !== selected) {
      this.renderer.showStatus('Tenant ID does not match. Operation cancelled.', 'warning');
      await this.renderer.pressEnterToContinue();
      return { type: 'back' };
    }

    const spinner = ora('Dropping tenant...').start();

    try {
      const migrator = createMigrator(this.ctx.config, {
        migrationsFolder: this.ctx.migrationsFolder,
        ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
        tenantDiscovery: async () => [],
      });

      await migrator.dropTenant(selected);

      spinner.succeed(`Tenant ${selected} dropped successfully`);
      console.log(chalk.dim(`\n  Schema ${status.schemaName} has been removed.`));
    } catch (error) {
      spinner.fail('Failed to drop tenant');
      console.log(chalk.red(`\n  ${(error as Error).message}`));
    }

    console.log('');
    await this.renderer.pressEnterToContinue();
    return { type: 'refresh' };
  }
}
