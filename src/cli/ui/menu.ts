import { select, confirm, input, checkbox, Separator } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMigrator } from '../../migrator/migrator.js';
import type { MultitenantConfig } from '../../types.js';
import type { TenantMigrationStatus, SeedFunction } from '../../migrator/types.js';
import {
  showBanner,
  showHeader,
  showStatus,
  clearScreen,
  formatTenantStatus,
  formatPendingCount,
  formatDuration,
} from './banner.js';
import {
  loadConfig,
  resolveMigrationsFolder,
} from '../utils/index.js';

interface MenuContext {
  config: MultitenantConfig;
  migrationsFolder: string;
  migrationsTable?: string;
  tenantDiscovery: () => Promise<string[]>;
}

/**
 * Wait for user to press Enter to continue
 */
async function pressEnterToContinue(): Promise<void> {
  await select({
    message: 'Press Enter to continue...',
    choices: [{ name: 'Continue', value: 'continue' }],
  });
}

/**
 * Load and validate configuration
 */
async function loadMenuContext(configPath?: string): Promise<MenuContext | null> {
  const spinner = ora('Loading configuration...').start();

  try {
    const {
      config,
      migrationsFolder,
      migrationsTable,
      tenantDiscovery,
    } = await loadConfig(configPath);

    if (!tenantDiscovery) {
      spinner.fail('No tenant discovery function found in config');
      console.log(chalk.dim('\nAdd migrations.tenantDiscovery to your config:'));
      console.log(chalk.dim('  migrations: {'));
      console.log(chalk.dim('    tenantDiscovery: async () => [\'tenant-1\', \'tenant-2\'],'));
      console.log(chalk.dim('  }'));
      return null;
    }

    const folder = resolveMigrationsFolder(migrationsFolder);
    spinner.succeed('Configuration loaded');

    return {
      config,
      migrationsFolder: folder,
      migrationsTable,
      tenantDiscovery,
    };
  } catch (error) {
    spinner.fail('Failed to load configuration');
    console.log(chalk.red(`\n  ${(error as Error).message}`));
    return null;
  }
}

/**
 * Get migration status for all tenants
 */
async function getTenantStatuses(ctx: MenuContext): Promise<TenantMigrationStatus[]> {
  const migrator = createMigrator(ctx.config, {
    migrationsFolder: ctx.migrationsFolder,
    ...(ctx.migrationsTable && { migrationsTable: ctx.migrationsTable }),
    tenantDiscovery: ctx.tenantDiscovery,
  });

  return migrator.getStatus();
}

/**
 * Create a status summary string
 */
function getStatusSummary(statuses: TenantMigrationStatus[]): {
  upToDate: number;
  behind: number;
  error: number;
  totalPending: number;
} {
  const upToDate = statuses.filter((s) => s.status === 'ok').length;
  const behind = statuses.filter((s) => s.status === 'behind').length;
  const error = statuses.filter((s) => s.status === 'error').length;
  const totalPending = statuses.reduce((sum, s) => sum + s.pendingCount, 0);

  return { upToDate, behind, error, totalPending };
}

/**
 * Display the main menu
 */
export async function mainMenu(configPath?: string): Promise<void> {
  clearScreen();
  showBanner();

  const ctx = await loadMenuContext(configPath);
  if (!ctx) {
    await pressEnterToContinue();
    return;
  }

  const spinner = ora('Fetching tenant status...').start();
  let statuses: TenantMigrationStatus[] = [];

  try {
    statuses = await getTenantStatuses(ctx);
    spinner.stop();
  } catch (error) {
    spinner.fail('Failed to fetch tenant status');
    console.log(chalk.red(`\n  ${(error as Error).message}`));
    await pressEnterToContinue();
    return mainMenu(configPath);
  }

  const summary = getStatusSummary(statuses);

  const choice = await select({
    message: 'drizzle-multitenant - Main Menu',
    choices: [
      {
        name: `Migration Status ${chalk.gray(`(${chalk.green(summary.upToDate)} ok, ${chalk.yellow(summary.behind)} pending)`)}`,
        value: 'status',
      },
      {
        name: `Migrate Tenants ${summary.totalPending > 0 ? chalk.yellow(`(${summary.totalPending} pending)`) : chalk.dim('(all up to date)')}`,
        value: 'migrate',
      },
      { name: 'Seed Tenants', value: 'seed' },
      new Separator(),
      { name: 'Create Tenant', value: 'create' },
      { name: 'Drop Tenant', value: 'drop' },
      new Separator(),
      { name: 'Generate Migration', value: 'generate' },
      { name: 'Refresh', value: 'refresh' },
      new Separator(),
      { name: 'Exit', value: 'exit' },
    ],
  });

  switch (choice) {
    case 'status':
      await statusMenu(ctx, statuses);
      break;
    case 'migrate':
      await migrateMenu(ctx, statuses);
      break;
    case 'seed':
      await seedMenu(ctx, statuses);
      break;
    case 'create':
      await createTenantMenu(ctx);
      break;
    case 'drop':
      await dropTenantMenu(ctx, statuses);
      break;
    case 'generate':
      await generateMigrationMenu(ctx);
      break;
    case 'refresh':
      await mainMenu(configPath);
      return;
    case 'exit':
      console.log(chalk.cyan('\n  Goodbye!\n'));
      process.exit(0);
  }

  await mainMenu(configPath);
}

/**
 * Display migration status menu
 */
async function statusMenu(
  ctx: MenuContext,
  statuses: TenantMigrationStatus[]
): Promise<void> {
  clearScreen();
  showHeader('Migration Status');

  if (statuses.length === 0) {
    showStatus('No tenants found', 'warning');
    await pressEnterToContinue();
    return;
  }

  // Create status table
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
      formatPendingCount(status.pendingCount),
      formatTenantStatus(status.status),
    ]);
  }

  console.log(table.toString());

  // Summary
  const summary = getStatusSummary(statuses);
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

  // Show pending migrations grouped
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

  console.log('');

  const action = await select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Migrate all pending', value: 'migrate', disabled: summary.totalPending === 0 },
      { name: 'View tenant details', value: 'details' },
      { name: chalk.gray('← Back to main menu'), value: 'back' },
    ],
  });

  if (action === 'migrate') {
    await migrateMenu(ctx, statuses);
  } else if (action === 'details') {
    await tenantDetailsMenu(ctx, statuses);
  }
}

/**
 * Display tenant details menu
 */
async function tenantDetailsMenu(
  ctx: MenuContext,
  statuses: TenantMigrationStatus[]
): Promise<void> {
  clearScreen();
  showHeader('Select Tenant');

  const choices = statuses.map((s) => ({
    name: `${formatTenantStatus(s.status).split(' ')[0]} ${s.tenantId} ${chalk.dim(`(${s.schemaName})`)}`,
    value: s.tenantId,
  }));
  choices.push({ name: chalk.gray('← Back'), value: 'back' });

  const selected = await select({
    message: 'Select a tenant to view details:',
    choices,
  });

  if (selected === 'back') {
    return statusMenu(ctx, statuses);
  }

  const status = statuses.find((s) => s.tenantId === selected);
  if (!status) return;

  clearScreen();
  showHeader(`Tenant: ${status.tenantId}`);

  console.log(chalk.bold('  Details:'));
  console.log(`    Schema:           ${status.schemaName}`);
  console.log(`    Format:           ${status.format || chalk.dim('(new)')}`);
  console.log(`    Applied:          ${chalk.green(status.appliedCount.toString())}`);
  console.log(`    Pending:          ${formatPendingCount(status.pendingCount)}`);
  console.log(`    Status:           ${formatTenantStatus(status.status)}`);

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
    await runMigration(ctx, [status.tenantId]);
    // Refresh statuses
    const newStatuses = await getTenantStatuses(ctx);
    await tenantDetailsMenu(ctx, newStatuses);
  } else {
    await tenantDetailsMenu(ctx, statuses);
  }
}

/**
 * Display migrate menu with tenant selection
 */
async function migrateMenu(
  ctx: MenuContext,
  statuses: TenantMigrationStatus[]
): Promise<void> {
  clearScreen();
  showHeader('Migrate Tenants');

  const pendingTenants = statuses.filter((s) => s.pendingCount > 0);

  if (pendingTenants.length === 0) {
    showStatus('All tenants are up to date', 'success');
    await pressEnterToContinue();
    return;
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
    showStatus('No tenants selected', 'warning');
    await pressEnterToContinue();
    return;
  }

  const confirmMigrate = await confirm({
    message: `Migrate ${selectedTenants.length} tenant(s)?`,
    default: true,
  });

  if (!confirmMigrate) {
    return;
  }

  await runMigration(ctx, selectedTenants);
}

/**
 * Run migrations for selected tenants
 */
async function runMigration(ctx: MenuContext, tenantIds: string[]): Promise<void> {
  clearScreen();
  showHeader('Running Migrations');

  const migrator = createMigrator(ctx.config, {
    migrationsFolder: ctx.migrationsFolder,
    ...(ctx.migrationsTable && { migrationsTable: ctx.migrationsTable }),
    tenantDiscovery: async () => tenantIds,
  });

  const startTime = Date.now();
  console.log(chalk.dim(`  Migrating ${tenantIds.length} tenant(s)...\n`));

  const results = await migrator.migrateAll({
    concurrency: 10,
    onProgress: (tenantId, status, migrationName) => {
      if (status === 'completed') {
        console.log(chalk.green(`  ✓ ${tenantId}`));
      } else if (status === 'failed') {
        console.log(chalk.red(`  ✗ ${tenantId}`));
      } else if (status === 'migrating' && migrationName) {
        console.log(chalk.dim(`    Applying: ${migrationName}`));
      }
    },
    onError: (tenantId, error) => {
      console.log(chalk.red(`    Error: ${error.message}`));
      return 'continue';
    },
  });

  const duration = Date.now() - startTime;

  console.log('');
  console.log(chalk.bold('  Results:'));
  console.log(`    Succeeded: ${chalk.green(results.succeeded.toString())}`);
  if (results.failed > 0) {
    console.log(`    Failed:    ${chalk.red(results.failed.toString())}`);
  }
  console.log(`    Duration:  ${chalk.dim(formatDuration(duration))}`);

  if (results.failed > 0) {
    console.log('');
    console.log(chalk.red('  Failed tenants:'));
    for (const detail of results.details.filter((d) => !d.success)) {
      console.log(`    ${chalk.red('✗')} ${detail.tenantId}: ${chalk.dim(detail.error || 'Unknown error')}`);
    }
  }

  console.log('');
  await pressEnterToContinue();
}

/**
 * Seed tenants menu
 */
async function seedMenu(
  ctx: MenuContext,
  statuses: TenantMigrationStatus[]
): Promise<void> {
  clearScreen();
  showHeader('Seed Tenants');

  if (statuses.length === 0) {
    showStatus('No tenants found', 'warning');
    await pressEnterToContinue();
    return;
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
  const spinner = ora('Loading seed file...').start();
  let seedFn: SeedFunction;

  try {
    const absolutePath = resolve(process.cwd(), seedFilePath);
    const seedFileUrl = pathToFileURL(absolutePath).href;
    const seedModule = await import(seedFileUrl);
    seedFn = seedModule.seed || seedModule.default;

    if (typeof seedFn !== 'function') {
      spinner.fail('Seed file must export a "seed" function or default export');
      console.log(chalk.dim('\n  Expected format:'));
      console.log(chalk.dim('    export const seed: SeedFunction = async (db, tenantId) => { ... };'));
      await pressEnterToContinue();
      return;
    }

    spinner.succeed('Seed file loaded');
  } catch (error) {
    spinner.fail('Failed to load seed file');
    const err = error as Error;
    if (err.message.includes('Cannot find module')) {
      console.log(chalk.red(`\n  File not found: ${seedFilePath}`));
    } else {
      console.log(chalk.red(`\n  ${err.message}`));
    }
    await pressEnterToContinue();
    return;
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
    showStatus('No tenants selected', 'warning');
    await pressEnterToContinue();
    return;
  }

  const confirmSeed = await confirm({
    message: `Seed ${selectedTenants.length} tenant(s)?`,
    default: true,
  });

  if (!confirmSeed) {
    return;
  }

  await runSeeding(ctx, selectedTenants, seedFn);
}

/**
 * Run seeding for selected tenants
 */
async function runSeeding(
  ctx: MenuContext,
  tenantIds: string[],
  seedFn: SeedFunction
): Promise<void> {
  clearScreen();
  showHeader('Running Seed');

  const migrator = createMigrator(ctx.config, {
    migrationsFolder: ctx.migrationsFolder,
    ...(ctx.migrationsTable && { migrationsTable: ctx.migrationsTable }),
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
    onError: (tenantId: string, error: Error) => {
      console.log(chalk.red(`    Error: ${error.message}`));
      return 'continue' as const;
    },
  });

  const duration = Date.now() - startTime;

  console.log('');
  console.log(chalk.bold('  Results:'));
  console.log(`    Succeeded: ${chalk.green(results.succeeded.toString())}`);
  if (results.failed > 0) {
    console.log(`    Failed:    ${chalk.red(results.failed.toString())}`);
  }
  console.log(`    Duration:  ${chalk.dim(formatDuration(duration))}`);

  if (results.failed > 0) {
    console.log('');
    console.log(chalk.red('  Failed tenants:'));
    for (const detail of results.details.filter((d) => !d.success)) {
      console.log(`    ${chalk.red('✗')} ${detail.tenantId}: ${chalk.dim(detail.error || 'Unknown error')}`);
    }
  }

  console.log('');
  await pressEnterToContinue();
}

/**
 * Create tenant menu
 */
async function createTenantMenu(ctx: MenuContext): Promise<void> {
  clearScreen();
  showHeader('Create Tenant');

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

  const schemaName = ctx.config.isolation.schemaNameTemplate(tenantId);

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
    return;
  }

  const spinner = ora('Creating tenant...').start();

  try {
    const migrator = createMigrator(ctx.config, {
      migrationsFolder: ctx.migrationsFolder,
      ...(ctx.migrationsTable && { migrationsTable: ctx.migrationsTable }),
      tenantDiscovery: async () => [],
    });

    // Check if tenant exists
    const exists = await migrator.tenantExists(tenantId);
    if (exists) {
      spinner.warn(`Tenant ${tenantId} already exists`);
      await pressEnterToContinue();
      return;
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
  await pressEnterToContinue();
}

/**
 * Drop tenant menu
 */
async function dropTenantMenu(
  ctx: MenuContext,
  statuses: TenantMigrationStatus[]
): Promise<void> {
  clearScreen();
  showHeader('Drop Tenant');

  if (statuses.length === 0) {
    showStatus('No tenants found', 'warning');
    await pressEnterToContinue();
    return;
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
    return;
  }

  const status = statuses.find((s) => s.tenantId === selected);
  if (!status) return;

  console.log('');
  console.log(chalk.red.bold('  WARNING: This action is irreversible!'));
  console.log(chalk.dim(`  Schema ${status.schemaName} and all its data will be deleted.`));
  console.log('');

  const confirmDrop = await confirm({
    message: `Are you sure you want to drop tenant "${selected}"?`,
    default: false,
  });

  if (!confirmDrop) {
    return;
  }

  // Double confirmation
  const confirmAgain = await input({
    message: `Type "${selected}" to confirm deletion:`,
  });

  if (confirmAgain !== selected) {
    showStatus('Tenant ID does not match. Operation cancelled.', 'warning');
    await pressEnterToContinue();
    return;
  }

  const spinner = ora('Dropping tenant...').start();

  try {
    const migrator = createMigrator(ctx.config, {
      migrationsFolder: ctx.migrationsFolder,
      ...(ctx.migrationsTable && { migrationsTable: ctx.migrationsTable }),
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
  await pressEnterToContinue();
}

/**
 * Generate migration menu
 */
async function generateMigrationMenu(ctx: MenuContext): Promise<void> {
  clearScreen();
  showHeader('Generate Migration');

  const name = await input({
    message: 'Migration name:',
    validate: (value) => {
      if (!value.trim()) return 'Migration name cannot be empty';
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
        return 'Invalid migration name format';
      }
      return true;
    },
  });

  console.log('');
  console.log(chalk.dim('  To generate a migration, run:'));
  console.log('');
  console.log(chalk.cyan(`  npx drizzle-kit generate --name=${name}`));
  console.log('');
  console.log(chalk.dim('  Or use drizzle-multitenant generate:'));
  console.log('');
  console.log(chalk.cyan(`  npx drizzle-multitenant generate --name=${name}`));
  console.log('');

  await pressEnterToContinue();
}

export default { mainMenu };
