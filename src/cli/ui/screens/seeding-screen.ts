import { checkbox, confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMigrator } from '../../../migrator/migrator.js';
import { MenuRenderer } from '../base/menu-renderer.js';
import type { MenuContext, TenantMigrationStatus, SeedFunction, ScreenAction } from '../types.js';
import type { SharedSeedFunction } from '../../../migrator/types.js';

/**
 * Screen for seeding tenant and shared databases
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
    this.renderer.showHeader('Seeding');

    const hasSharedSchema = !!this.ctx.config.schemas?.shared;

    // Show options menu
    const choices = [
      { name: 'Seed tenants', value: 'tenants' as const },
      ...(hasSharedSchema
        ? [{ name: 'Seed shared schema', value: 'shared' as const }]
        : []),
      ...(hasSharedSchema
        ? [{ name: 'Seed all (shared + tenants)', value: 'all' as const }]
        : []),
      { name: chalk.dim('← Back'), value: 'back' as const },
    ];

    const action = await select({
      message: 'Select seeding action:',
      choices,
    });

    if (action === 'back') {
      return { type: 'back' };
    }

    if (action === 'shared') {
      return this.showSharedSeeding();
    }

    if (action === 'all') {
      return this.showAllSeeding(statuses);
    }

    return this.showTenantSeeding(statuses);
  }

  /**
   * Show tenant seeding flow
   */
  private async showTenantSeeding(statuses: TenantMigrationStatus[]): Promise<ScreenAction> {
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
      default: './seeds/tenant/initial.ts',
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
   * Show shared schema seeding flow
   */
  private async showSharedSeeding(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Seed Shared Schema');

    // Prompt for seed file path
    const seedFilePath = await input({
      message: 'Shared seed file path:',
      default: './seeds/shared/plans.ts',
      validate: (value) => {
        if (!value.trim()) return 'Seed file path cannot be empty';
        return true;
      },
    });

    // Load seed file
    const seedFn = await this.loadSharedSeedFile(seedFilePath);
    if (!seedFn) {
      return { type: 'back' };
    }

    const confirmSeed = await confirm({
      message: 'Seed shared schema (public)?',
      default: true,
    });

    if (!confirmSeed) {
      return { type: 'back' };
    }

    await this.runSharedSeeding(seedFn);
    return { type: 'back' };
  }

  /**
   * Show all seeding flow (shared + tenants)
   */
  private async showAllSeeding(statuses: TenantMigrationStatus[]): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Seed All (Shared + Tenants)');

    if (statuses.length === 0) {
      this.renderer.showStatus('No tenants found', 'warning');
      await this.renderer.pressEnterToContinue();
      return { type: 'back' };
    }

    // Prompt for shared seed file path
    const sharedSeedFilePath = await input({
      message: 'Shared seed file path:',
      default: './seeds/shared/plans.ts',
      validate: (value) => {
        if (!value.trim()) return 'Seed file path cannot be empty';
        return true;
      },
    });

    // Load shared seed file
    const sharedSeedFn = await this.loadSharedSeedFile(sharedSeedFilePath);
    if (!sharedSeedFn) {
      return { type: 'back' };
    }

    console.log('');

    // Prompt for tenant seed file path
    const tenantSeedFilePath = await input({
      message: 'Tenant seed file path:',
      default: './seeds/tenant/initial.ts',
      validate: (value) => {
        if (!value.trim()) return 'Seed file path cannot be empty';
        return true;
      },
    });

    // Load tenant seed file
    const tenantSeedFn = await this.loadSeedFile(tenantSeedFilePath);
    if (!tenantSeedFn) {
      return { type: 'back' };
    }

    console.log('');

    const confirmSeed = await confirm({
      message: `Seed shared schema and ${statuses.length} tenant(s)?`,
      default: true,
    });

    if (!confirmSeed) {
      return { type: 'back' };
    }

    await this.runAllSeeding(sharedSeedFn, tenantSeedFn, statuses.map((s) => s.tenantId));
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
   * Load shared seed function from file
   */
  private async loadSharedSeedFile(seedFilePath: string): Promise<SharedSeedFunction | null> {
    const spinner = ora('Loading shared seed file...').start();

    try {
      const absolutePath = resolve(process.cwd(), seedFilePath);
      const seedFileUrl = pathToFileURL(absolutePath).href;
      const seedModule = await import(seedFileUrl);
      const seedFn = seedModule.seed || seedModule.default;

      if (typeof seedFn !== 'function') {
        spinner.fail('Seed file must export a "seed" function or default export');
        console.log(chalk.dim('\n  Expected format:'));
        console.log(chalk.dim('    export const seed: SharedSeedFunction = async (db) => { ... };'));
        await this.renderer.pressEnterToContinue();
        return null;
      }

      spinner.succeed('Shared seed file loaded');
      return seedFn;
    } catch (error) {
      spinner.fail('Failed to load shared seed file');
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

  /**
   * Run seeding for shared schema
   */
  private async runSharedSeeding(seedFn: SharedSeedFunction): Promise<void> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Running Shared Seed');

    const migrator = createMigrator(this.ctx.config, {
      migrationsFolder: this.ctx.migrationsFolder,
      ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
      tenantDiscovery: async () => [],
    });

    const spinner = ora('Seeding shared schema...').start();
    const startTime = Date.now();

    const result = await migrator.seedShared(seedFn as any);
    const duration = Date.now() - startTime;

    if (result.success) {
      spinner.succeed(`Shared schema seeded successfully in ${duration}ms`);
    } else {
      spinner.fail(`Failed to seed shared schema: ${result.error}`);
    }

    console.log('');
    console.log(chalk.bold('Summary:'));
    console.log(`  Schema:     ${result.schemaName}`);
    console.log(`  Status:     ${result.success ? chalk.green('success') : chalk.red('failed')}`);
    console.log(`  Duration:   ${chalk.dim(`${duration}ms`)}`);

    if (result.error) {
      console.log(chalk.red(`\n  Error: ${result.error}`));
    }

    console.log('');
    await this.renderer.pressEnterToContinue();
  }

  /**
   * Run seeding for shared schema and all tenants
   */
  private async runAllSeeding(
    sharedSeedFn: SharedSeedFunction,
    tenantSeedFn: SeedFunction,
    tenantIds: string[]
  ): Promise<void> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Running Full Seed');

    const migrator = createMigrator(this.ctx.config, {
      migrationsFolder: this.ctx.migrationsFolder,
      ...(this.ctx.migrationsTable && { migrationsTable: this.ctx.migrationsTable }),
      tenantDiscovery: async () => tenantIds,
    });

    const startTime = Date.now();

    // Step 1: Seed shared schema
    console.log(chalk.bold('\n[1/2] Seeding shared schema...\n'));
    const sharedSpinner = ora('Seeding shared schema...').start();

    const sharedResult = await migrator.seedShared(sharedSeedFn as any);

    if (sharedResult.success) {
      sharedSpinner.succeed(`Shared schema seeded in ${sharedResult.durationMs}ms`);
    } else {
      sharedSpinner.fail(`Failed: ${sharedResult.error}`);
    }

    // Step 2: Seed tenants
    console.log(chalk.bold(`\n[2/2] Seeding ${tenantIds.length} tenant(s)...\n`));

    const tenantsResult = await migrator.seedAll(tenantSeedFn as any, {
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

    const totalDuration = Date.now() - startTime;

    // Summary
    console.log('');
    console.log(chalk.bold('Summary:'));
    console.log(chalk.bold('  Shared:'));
    console.log(`    Schema:     ${sharedResult.schemaName}`);
    console.log(`    Status:     ${sharedResult.success ? chalk.green('success') : chalk.red('failed')}`);
    console.log(`    Duration:   ${chalk.dim(`${sharedResult.durationMs}ms`)}`);

    console.log(chalk.bold('\n  Tenants:'));
    console.log(`    Total:      ${tenantsResult.total}`);
    console.log(`    Succeeded:  ${chalk.green(tenantsResult.succeeded.toString())}`);
    if (tenantsResult.failed > 0) {
      console.log(`    Failed:     ${chalk.red(tenantsResult.failed.toString())}`);
    }
    if (tenantsResult.skipped > 0) {
      console.log(`    Skipped:    ${chalk.yellow(tenantsResult.skipped.toString())}`);
    }

    console.log(chalk.bold('\n  Total:'));
    console.log(`    Duration:   ${chalk.dim(`${totalDuration}ms`)}`);

    console.log('');
    await this.renderer.pressEnterToContinue();
  }
}
