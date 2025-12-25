import { select, Separator } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { createMigrator } from '../../migrator/migrator.js';
import type { TenantMigrationStatus, SharedMigrationStatus } from '../../migrator/types.js';
import { showBanner } from './banner.js';
import { MenuRenderer } from './base/menu-renderer.js';
import {
  StatusScreen,
  MigrationsScreen,
  TenantsScreen,
  SeedingScreen,
  GenerateScreen,
  LintScreen,
} from './screens/index.js';
import type { MenuContext, ScreenAction } from './types.js';
import { loadConfig, resolveMigrationsFolder } from '../utils/index.js';

/**
 * Main menu orchestrator
 * Delegates to individual screens for specific functionality
 */
export class MainMenu {
  private readonly renderer: MenuRenderer;
  private ctx: MenuContext | null = null;
  private statuses: TenantMigrationStatus[] = [];
  private sharedStatus: SharedMigrationStatus | null = null;
  private hasSharedMigrations = false;

  constructor(
    private readonly configPath?: string
  ) {
    this.renderer = new MenuRenderer();
  }

  /**
   * Start the interactive menu
   */
  async start(): Promise<void> {
    this.renderer.clearScreen();
    showBanner();

    // Load configuration
    this.ctx = await this.loadMenuContext();
    if (!this.ctx) {
      await this.renderer.pressEnterToContinue();
      return;
    }

    // Fetch initial status
    await this.refreshStatuses();

    // Main loop
    await this.loop();
  }

  /**
   * Main menu loop
   */
  private async loop(): Promise<void> {
    while (true) {
      const action = await this.showMainMenu();

      if (action.type === 'exit') {
        console.log(chalk.cyan('\n  Goodbye!\n'));
        process.exit(0);
      }

      if (action.type === 'refresh') {
        await this.refreshStatuses();
      }
    }
  }

  /**
   * Show main menu and handle selection
   */
  private async showMainMenu(): Promise<ScreenAction> {
    const summary = this.renderer.getStatusSummary(this.statuses);

    // Build choices dynamically based on shared migrations availability
    const choices: Array<{ name: string; value: string } | Separator> = [
      {
        name: `Migration Status ${chalk.gray(`(${chalk.green(summary.upToDate)} ok, ${chalk.yellow(summary.behind)} pending)`)}`,
        value: 'status',
      },
      {
        name: `Migrate Tenants ${summary.totalPending > 0 ? chalk.yellow(`(${summary.totalPending} pending)`) : chalk.dim('(all up to date)')}`,
        value: 'migrate',
      },
    ];

    // Add shared migrations options if available
    if (this.hasSharedMigrations && this.sharedStatus) {
      const sharedPending = this.sharedStatus.pendingCount;
      choices.push({
        name: `Migrate Shared Schema ${sharedPending > 0 ? chalk.yellow(`(${sharedPending} pending)`) : chalk.dim('(up to date)')}`,
        value: 'migrate-shared',
      });
    }

    choices.push(
      { name: 'Seed Tenants', value: 'seed' },
      new Separator(),
      { name: 'Create Tenant', value: 'create' },
      { name: 'Clone Tenant', value: 'clone' },
      { name: 'Drop Tenant', value: 'drop' },
      new Separator(),
      { name: 'Generate Migration', value: 'generate' },
    );

    // Add shared generate option if configured
    if (this.hasSharedMigrations) {
      choices.push({ name: 'Generate Shared Migration', value: 'generate-shared' });
    }

    choices.push(
      new Separator(),
      { name: 'Schema Lint', value: 'lint' },
      { name: 'Refresh', value: 'refresh' },
      new Separator(),
      { name: 'Exit', value: 'exit' },
    );

    const choice = await select({
      message: 'drizzle-multitenant - Main Menu',
      choices,
    });

    return this.handleChoice(choice);
  }

  /**
   * Handle menu choice by delegating to appropriate screen
   */
  private async handleChoice(choice: string): Promise<ScreenAction> {
    if (!this.ctx) {
      return { type: 'exit' };
    }

    switch (choice) {
      case 'status': {
        const screen = new StatusScreen(this.ctx, this.renderer);
        const action = await screen.show(this.statuses);
        return this.handleScreenAction(action);
      }

      case 'migrate': {
        const screen = new MigrationsScreen(this.ctx, this.renderer);
        const action = await screen.show(this.statuses);
        return this.handleScreenAction(action);
      }

      case 'seed': {
        const screen = new SeedingScreen(this.ctx, this.renderer);
        const action = await screen.show(this.statuses);
        return this.handleScreenAction(action);
      }

      case 'create': {
        const screen = new TenantsScreen(this.ctx, this.renderer);
        const action = await screen.showCreate();
        return this.handleScreenAction(action);
      }

      case 'clone': {
        const screen = new TenantsScreen(this.ctx, this.renderer);
        const action = await screen.showClone(this.statuses);
        return this.handleScreenAction(action);
      }

      case 'drop': {
        const screen = new TenantsScreen(this.ctx, this.renderer);
        const action = await screen.showDrop(this.statuses);
        return this.handleScreenAction(action);
      }

      case 'generate': {
        const screen = new GenerateScreen(this.ctx, this.renderer);
        await screen.show();
        return { type: 'back' };
      }

      case 'migrate-shared': {
        await this.migrateShared();
        await this.refreshStatuses();
        return { type: 'refresh' };
      }

      case 'generate-shared': {
        const screen = new GenerateScreen(this.ctx, this.renderer);
        await screen.showShared();
        return { type: 'back' };
      }

      case 'lint': {
        const screen = new LintScreen(this.ctx, this.renderer);
        await screen.show();
        return { type: 'back' };
      }

      case 'refresh':
        await this.refreshStatuses();
        return { type: 'refresh' };

      case 'exit':
        return { type: 'exit' };

      default:
        return { type: 'back' };
    }
  }

  /**
   * Migrate shared schema
   */
  private async migrateShared(): Promise<void> {
    if (!this.ctx || !this.sharedStatus) return;

    if (this.sharedStatus.pendingCount === 0) {
      console.log(chalk.green('\n  Shared schema is already up to date.\n'));
      await this.renderer.pressEnterToContinue();
      return;
    }

    console.log(chalk.cyan(`\n  Pending shared migrations: ${this.sharedStatus.pendingCount}\n`));
    for (const name of this.sharedStatus.pendingMigrations) {
      console.log(chalk.dim(`    - ${name}`));
    }
    console.log('');

    const spinner = ora('Migrating shared schema...').start();

    try {
      const migrator = createMigrator(this.ctx.config, {
        migrationsFolder: this.ctx.migrationsFolder,
        sharedMigrationsFolder: this.ctx.sharedMigrationsFolder,
        ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
        tenantDiscovery: this.ctx.tenantDiscovery,
      });

      const result = await migrator.migrateShared({
        onProgress: (status, name) => {
          if (status === 'migrating' && name) {
            spinner.text = `Applying: ${name}`;
          }
        },
      });

      if (result.success) {
        spinner.succeed(`Applied ${result.appliedMigrations.length} migration(s)`);
        console.log('');
        for (const name of result.appliedMigrations) {
          console.log(chalk.green(`  ✓ ${name}`));
        }
      } else {
        spinner.fail('Migration failed');
        console.log(chalk.red(`\n  Error: ${result.error}`));
      }
    } catch (error) {
      spinner.fail('Migration failed');
      console.log(chalk.red(`\n  ${(error as Error).message}`));
    }

    console.log('');
    await this.renderer.pressEnterToContinue();
  }

  /**
   * Handle action returned from a screen
   */
  private async handleScreenAction(action: ScreenAction): Promise<ScreenAction> {
    if (!this.ctx) {
      return { type: 'exit' };
    }

    if (action.type === 'navigate') {
      switch (action.screen) {
        case 'migrate': {
          const screen = new MigrationsScreen(this.ctx, this.renderer);
          const result = await screen.show(this.statuses);
          return this.handleScreenAction(result);
        }

        case 'migrate-single': {
          const tenantId = action.params?.tenantId as string;
          if (tenantId) {
            const screen = new MigrationsScreen(this.ctx, this.renderer);
            const result = await screen.migrateSingle(tenantId);
            await this.refreshStatuses();
            return result;
          }
          return { type: 'back' };
        }

        default:
          return { type: 'back' };
      }
    }

    if (action.type === 'refresh') {
      await this.refreshStatuses();
    }

    return action;
  }

  /**
   * Load and validate configuration
   */
  private async loadMenuContext(): Promise<MenuContext | null> {
    const spinner = ora('Loading configuration...').start();

    try {
      const { config, migrationsFolder, migrationsTable, tenantDiscovery, sharedMigrationsFolder } =
        await loadConfig(this.configPath);

      if (!tenantDiscovery) {
        spinner.fail('No tenant discovery function found in config');
        console.log(chalk.dim('\nAdd migrations.tenantDiscovery to your config:'));
        console.log(chalk.dim('  migrations: {'));
        console.log(chalk.dim("    tenantDiscovery: async () => ['tenant-1', 'tenant-2'],"));
        console.log(chalk.dim('  }'));
        return null;
      }

      const folder = resolveMigrationsFolder(migrationsFolder);

      // Try to resolve shared migrations folder if configured
      let sharedFolder: string | undefined;
      if (sharedMigrationsFolder) {
        try {
          sharedFolder = resolveMigrationsFolder(sharedMigrationsFolder);
          this.hasSharedMigrations = true;
        } catch {
          // Shared folder doesn't exist yet, that's fine
          this.hasSharedMigrations = false;
        }
      }

      spinner.succeed('Configuration loaded');

      return {
        config,
        migrationsFolder: folder,
        migrationsTable,
        tenantDiscovery,
        sharedMigrationsFolder: sharedFolder,
      };
    } catch (error) {
      spinner.fail('Failed to load configuration');
      console.log(chalk.red(`\n  ${(error as Error).message}`));
      return null;
    }
  }

  /**
   * Refresh tenant statuses
   */
  private async refreshStatuses(): Promise<void> {
    if (!this.ctx) return;

    const spinner = ora('Fetching status...').start();

    try {
      const migrator = createMigrator(this.ctx.config, {
        migrationsFolder: this.ctx.migrationsFolder,
        sharedMigrationsFolder: this.ctx.sharedMigrationsFolder,
        ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
        tenantDiscovery: this.ctx.tenantDiscovery,
      });

      // Fetch tenant statuses
      this.statuses = await migrator.getStatus();

      // Fetch shared status if configured
      if (this.hasSharedMigrations) {
        this.sharedStatus = await migrator.getSharedStatus();
      }

      spinner.stop();
    } catch (error) {
      spinner.fail('Failed to fetch status');
      console.log(chalk.red(`\n  ${(error as Error).message}`));
      this.statuses = [];
      this.sharedStatus = null;
    }
  }
}

/**
 * Display the main menu (entry point)
 */
export async function mainMenu(configPath?: string): Promise<void> {
  const menu = new MainMenu(configPath);
  await menu.start();
}

export default { mainMenu };
