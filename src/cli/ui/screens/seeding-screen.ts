import { checkbox, confirm, input } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMigrator } from '../../../migrator/migrator.js';
import { MenuRenderer } from '../base/menu-renderer.js';
import type { MenuContext, TenantMigrationStatus, SeedFunction, ScreenAction } from '../types.js';

/**
 * Screen for seeding tenant databases
 */
export class SeedingScreen {
  private readonly renderer: MenuRenderer;

  constructor(
    private readonly ctx: MenuContext,
    renderer?: MenuRenderer
  ) {
    this.renderer = renderer || new MenuRenderer();
  }

  /**
   * Show seed menu
   */
  async show(statuses: TenantMigrationStatus[]): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Seed Tenants');

    if (statuses.length === 0) {
      this.renderer.showStatus('No tenants found', 'warning');
      await this.renderer.pressEnterToContinue();
      return { type: 'back' };
    }

    // Prompt for seed file path
    const seedFilePath = await input({
      message: 'Seed file path:',
      default: './seeds/initial.ts',
      validate: (value) => {
        if (!value.trim()) return 'Seed file path cannot be empty';
        return true;
      },
    });

    // Load seed file
    const seedFn = await this.loadSeedFile(seedFilePath);
    if (!seedFn) {
      return { type: 'back' };
    }

    console.log('');

    // Select tenants
    const selectedTenants = await checkbox({
      message: 'Select tenants to seed:',
      choices: statuses.map((s) => ({
        name: `${s.tenantId} ${chalk.dim(`(${s.schemaName})`)}`,
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

    const confirmSeed = await confirm({
      message: `Seed ${selectedTenants.length} tenant(s)?`,
      default: true,
    });

    if (!confirmSeed) {
      return { type: 'back' };
    }

    await this.runSeeding(selectedTenants, seedFn);
    return { type: 'back' };
  }

  /**
   * Load seed function from file
   */
  private async loadSeedFile(seedFilePath: string): Promise<SeedFunction | null> {
    const spinner = ora('Loading seed file...').start();

    try {
      const absolutePath = resolve(process.cwd(), seedFilePath);
      const seedFileUrl = pathToFileURL(absolutePath).href;
      const seedModule = await import(seedFileUrl);
      const seedFn = seedModule.seed || seedModule.default;

      if (typeof seedFn !== 'function') {
        spinner.fail('Seed file must export a "seed" function or default export');
        console.log(chalk.dim('\n  Expected format:'));
        console.log(chalk.dim('    export const seed: SeedFunction = async (db, tenantId) => { ... };'));
        await this.renderer.pressEnterToContinue();
        return null;
      }

      spinner.succeed('Seed file loaded');
      return seedFn;
    } catch (error) {
      spinner.fail('Failed to load seed file');
      const err = error as Error;
      if (err.message.includes('Cannot find module')) {
        console.log(chalk.red(`\n  File not found: ${seedFilePath}`));
      } else {
        console.log(chalk.red(`\n  ${err.message}`));
      }
      await this.renderer.pressEnterToContinue();
      return null;
    }
  }

  /**
   * Run seeding for selected tenants
   */
  private async runSeeding(tenantIds: string[], seedFn: SeedFunction): Promise<void> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Running Seed');

    const migrator = createMigrator(this.ctx.config, {
      migrationsFolder: this.ctx.migrationsFolder,
      ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
      tenantDiscovery: async () => tenantIds,
    });

    const startTime = Date.now();
    console.log(chalk.dim(`  Seeding ${tenantIds.length} tenant(s)...\n`));

    const results = await migrator.seedAll(seedFn as any, {
      concurrency: 10,
      onProgress: (tenantId: string, status: string) => {
        if (status === 'completed') {
          console.log(chalk.green(`  ✓ ${tenantId}`));
        } else if (status === 'failed') {
          console.log(chalk.red(`  ✗ ${tenantId}`));
        }
      },
      onError: (_tenantId: string, error: Error) => {
        console.log(chalk.red(`    Error: ${error.message}`));
        return 'continue' as const;
      },
    });

    const duration = Date.now() - startTime;
    this.renderer.showResults(results, duration);

    console.log('');
    await this.renderer.pressEnterToContinue();
  }
}
