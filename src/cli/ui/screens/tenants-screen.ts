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

  /**
   * Show clone tenant screen
   */
  async showClone(statuses: TenantMigrationStatus[]): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Clone Tenant');

    if (statuses.length === 0) {
      this.renderer.showStatus('No tenants found to clone from', 'warning');
      await this.renderer.pressEnterToContinue();
      return { type: 'back' };
    }

    // Select source tenant
    const sourceChoices = statuses.map((s) => ({
      name: `${s.tenantId} ${chalk.dim(`(${s.schemaName})`)}`,
      value: s.tenantId,
    }));
    sourceChoices.push({ name: chalk.gray('← Cancel'), value: 'cancel' });

    const sourceId = await select({
      message: 'Select source tenant:',
      choices: sourceChoices,
    });

    if (sourceId === 'cancel') {
      return { type: 'back' };
    }

    // Input target tenant ID
    const existingIds = new Set(statuses.map((s) => s.tenantId));
    const targetId = await input({
      message: 'New tenant ID:',
      validate: (value) => {
        if (!value.trim()) return 'Tenant ID cannot be empty';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {
          return 'Invalid tenant ID format (use alphanumeric, dashes, underscores)';
        }
        if (existingIds.has(value)) {
          return 'Tenant already exists';
        }
        return true;
      },
    });

    const targetSchema = this.ctx.config.isolation.schemaNameTemplate(targetId);
    console.log(chalk.dim(`\n  Target schema: ${targetSchema}`));

    // Ask about data copy
    const includeData = await confirm({
      message: 'Include data in clone?',
      default: false,
    });

    let anonymize = false;
    if (includeData) {
      anonymize = await confirm({
        message: 'Anonymize sensitive data?',
        default: false,
      });
    }

    // Confirmation
    console.log('');
    console.log(chalk.dim('  Clone configuration:'));
    console.log(chalk.dim(`    Source: ${sourceId}`));
    console.log(chalk.dim(`    Target: ${targetId} (${targetSchema})`));
    console.log(chalk.dim(`    Data: ${includeData ? (anonymize ? 'Yes (anonymized)' : 'Yes') : 'No (schema only)'}`));
    console.log('');

    const confirmClone = await confirm({
      message: `Clone "${sourceId}" to "${targetId}"?`,
      default: true,
    });

    if (!confirmClone) {
      return { type: 'back' };
    }

    const spinner = ora('Cloning tenant...').start();

    try {
      const migrator = createMigrator(this.ctx.config, {
        migrationsFolder: this.ctx.migrationsFolder,
        ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
        tenantDiscovery: async () => [],
      });

      const result = await migrator.cloneTenant(sourceId, targetId, {
        includeData,
        anonymize: anonymize ? { enabled: true } : undefined,
        onProgress: (status, details) => {
          switch (status) {
            case 'introspecting':
              spinner.text = 'Introspecting source schema...';
              break;
            case 'creating_schema':
              spinner.text = 'Creating target schema...';
              break;
            case 'creating_tables':
              spinner.text = 'Creating tables...';
              break;
            case 'creating_indexes':
              spinner.text = 'Creating indexes...';
              break;
            case 'creating_constraints':
              spinner.text = 'Creating constraints...';
              break;
            case 'copying_data':
              if (details?.table) {
                spinner.text = `Copying: ${details.table} (${details.progress}/${details.total})...`;
              } else {
                spinner.text = 'Copying data...';
              }
              break;
          }
        },
      });

      if (!result.success) {
        spinner.fail('Clone failed');
        console.log(chalk.red(`\n  ${result.error}`));
      } else {
        spinner.succeed(`Tenant ${targetId} cloned successfully`);
        console.log('');
        console.log(chalk.green('  ✓ Tables: ') + chalk.dim(result.tables.length.toString()));
        if (includeData && result.rowsCopied !== undefined) {
          console.log(chalk.green('  ✓ Rows copied: ') + chalk.dim(result.rowsCopied.toLocaleString()));
          if (anonymize) {
            console.log(chalk.green('  ✓ Data anonymized'));
          }
        }
        console.log(chalk.dim(`\n  Duration: ${result.durationMs}ms`));
        console.log(chalk.dim('\n  Usage:'));
        console.log(chalk.dim(`    const db = tenants.getDb('${targetId}');`));
      }
    } catch (error) {
      spinner.fail('Clone failed');
      console.log(chalk.red(`\n  ${(error as Error).message}`));
    }

    console.log('');
    await this.renderer.pressEnterToContinue();
    return { type: 'refresh' };
  }
}
