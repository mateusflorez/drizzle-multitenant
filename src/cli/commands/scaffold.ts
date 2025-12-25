/**
 * Scaffold command for generating boilerplate code
 *
 * @module cli/commands/scaffold
 */

import { Command } from 'commander';
import { select, confirm, input } from '@inquirer/prompts';

import {
  scaffoldSchema,
  scaffoldSeed,
  scaffoldMigration,
  getMigrationTemplates,
  DEFAULT_DIRS,
} from '../../scaffold/index.js';
import type { ScaffoldType, MigrationTemplate } from '../../scaffold/types.js';
import {
  createSpinner,
  success,
  error,
  dim,
  info,
  warning,
  outputJson,
  getOutputContext,
} from '../utils/index.js';
import { handleError, CLIErrors } from '../utils/errors.js';

/**
 * JSON output for scaffold commands
 */
interface ScaffoldJsonOutput {
  success: boolean;
  kind: 'schema' | 'seed' | 'migration';
  type: ScaffoldType;
  filePath: string;
  fileName: string;
  error?: string;
}

/**
 * Scaffold schema command
 */
export const scaffoldSchemaCommand = new Command('scaffold:schema')
  .description('Generate a new Drizzle schema file')
  .argument('<name>', 'Schema/table name (e.g., orders, user-profiles)')
  .option('-t, --type <type>', 'Schema type: tenant or shared', 'tenant')
  .option('-o, --output <path>', 'Output directory')
  .option('--no-timestamps', 'Do not include createdAt/updatedAt columns')
  .option('--soft-delete', 'Include deletedAt column for soft delete')
  .option('--no-uuid', 'Use serial instead of UUID for primary key')
  .option('--no-example', 'Do not include example columns')
  .option('-i, --interactive', 'Run in interactive mode')
  .addHelpText(
    'after',
    `
Examples:
  $ drizzle-multitenant scaffold:schema orders --type=tenant
  $ drizzle-multitenant scaffold:schema plans --type=shared
  $ drizzle-multitenant scaffold:schema products -t tenant --soft-delete
  $ drizzle-multitenant scaffold:schema orders -i  # interactive mode
`
  )
  .action(async (name: string, options) => {
    const spinner = createSpinner('Generating schema...');

    try {
      let type = options.type as ScaffoldType;
      let includeTimestamps = options.timestamps !== false;
      let includeSoftDelete = options.softDelete === true;
      let useUuid = options.uuid !== false;
      let includeExample = options.example !== false;

      // Interactive mode
      if (options.interactive) {
        type = await select<ScaffoldType>({
          message: 'Schema type:',
          choices: [
            { value: 'tenant', name: 'Tenant - Per-tenant schema' },
            { value: 'shared', name: 'Shared - Public/shared schema' },
          ],
        });

        includeTimestamps = await confirm({
          message: 'Include timestamps (createdAt, updatedAt)?',
          default: true,
        });

        includeSoftDelete = await confirm({
          message: 'Include soft delete (deletedAt)?',
          default: false,
        });

        useUuid = await confirm({
          message: 'Use UUID for primary key?',
          default: true,
        });

        includeExample = await confirm({
          message: 'Include example columns (name, description, isActive)?',
          default: true,
        });
      }

      spinner.start();

      const result = await scaffoldSchema({
        name,
        type,
        outputDir: options.output,
        includeTimestamps,
        includeSoftDelete,
        useUuid,
        includeExample,
      });

      const ctx = getOutputContext();
      if (ctx.jsonMode) {
        outputJson<ScaffoldJsonOutput>({
          success: result.success,
          kind: 'schema',
          type: result.type,
          filePath: result.filePath,
          fileName: result.fileName,
          error: result.error,
        });
        if (!result.success) process.exit(1);
        return;
      }

      if (!result.success) {
        spinner.fail(result.error || 'Failed to generate schema');
        process.exit(1);
      }

      spinner.succeed('Schema generated');
      console.log('\n' + success(`Created: ${dim(result.filePath)}`));
      console.log(dim('\nNext steps:'));
      console.log(dim('  1. Review and customize the generated schema'));
      console.log(dim('  2. Add relations if needed'));
      console.log(dim('  3. Generate a migration: npx drizzle-multitenant generate -n add-' + name));
    } catch (err) {
      spinner.fail('Failed to generate schema');
      handleError(err);
    }
  });

/**
 * Scaffold seed command
 */
export const scaffoldSeedCommand = new Command('scaffold:seed')
  .description('Generate a new seed file')
  .argument('<name>', 'Seed name (e.g., initial, demo-data)')
  .option('-t, --type <type>', 'Seed type: tenant or shared', 'tenant')
  .option('-o, --output <path>', 'Output directory')
  .option('--table <name>', 'Table name to seed (for import template)')
  .option('-i, --interactive', 'Run in interactive mode')
  .addHelpText(
    'after',
    `
Examples:
  $ drizzle-multitenant scaffold:seed initial --type=tenant
  $ drizzle-multitenant scaffold:seed plans --type=shared --table=plans
  $ drizzle-multitenant scaffold:seed demo-data -t tenant -i
`
  )
  .action(async (name: string, options) => {
    const spinner = createSpinner('Generating seed...');

    try {
      let type = options.type as ScaffoldType;
      let tableName = options.table;

      // Interactive mode
      if (options.interactive) {
        type = await select<ScaffoldType>({
          message: 'Seed type:',
          choices: [
            { value: 'tenant', name: 'Tenant - Runs per-tenant' },
            { value: 'shared', name: 'Shared - Runs once for shared schema' },
          ],
        });

        const hasTable = await confirm({
          message: 'Include table import template?',
          default: false,
        });

        if (hasTable) {
          tableName = await input({
            message: 'Table name:',
            default: name,
          });
        }
      }

      spinner.start();

      const result = await scaffoldSeed({
        name,
        type,
        outputDir: options.output,
        tableName,
      });

      const ctx = getOutputContext();
      if (ctx.jsonMode) {
        outputJson<ScaffoldJsonOutput>({
          success: result.success,
          kind: 'seed',
          type: result.type,
          filePath: result.filePath,
          fileName: result.fileName,
          error: result.error,
        });
        if (!result.success) process.exit(1);
        return;
      }

      if (!result.success) {
        spinner.fail(result.error || 'Failed to generate seed');
        process.exit(1);
      }

      spinner.succeed('Seed generated');
      console.log('\n' + success(`Created: ${dim(result.filePath)}`));
      console.log(dim('\nNext steps:'));
      console.log(dim('  1. Edit the seed file with your data'));
      if (type === 'tenant') {
        console.log(dim('  2. Run: npx drizzle-multitenant seed --file=' + result.filePath + ' --all'));
      } else {
        console.log(dim('  2. Run: npx drizzle-multitenant seed:shared --file=' + result.filePath));
      }
    } catch (err) {
      spinner.fail('Failed to generate seed');
      handleError(err);
    }
  });

/**
 * Scaffold migration command
 */
export const scaffoldMigrationCommand = new Command('scaffold:migration')
  .description('Generate a new migration file with template')
  .argument('<name>', 'Migration name (e.g., add-orders, create-users)')
  .option('-t, --type <type>', 'Migration type: tenant or shared', 'tenant')
  .option('-o, --output <path>', 'Output directory (overrides config)')
  .option('--template <template>', 'Template: create-table, add-column, add-index, add-foreign-key, blank')
  .option('-i, --interactive', 'Run in interactive mode')
  .addHelpText(
    'after',
    `
Examples:
  $ drizzle-multitenant scaffold:migration add-orders --type=tenant
  $ drizzle-multitenant scaffold:migration create-plans --type=shared --template=create-table
  $ drizzle-multitenant scaffold:migration add-user-index -t tenant --template=add-index
  $ drizzle-multitenant scaffold:migration my-migration -i  # interactive mode
`
  )
  .action(async (name: string, options) => {
    const spinner = createSpinner('Generating migration...');

    try {
      let type = options.type as ScaffoldType;
      let template = options.template as MigrationTemplate | undefined;

      // Interactive mode
      if (options.interactive) {
        type = await select<ScaffoldType>({
          message: 'Migration type:',
          choices: [
            { value: 'tenant', name: 'Tenant - Applied to all tenant schemas' },
            { value: 'shared', name: 'Shared - Applied to public/shared schema' },
          ],
        });

        const templates = getMigrationTemplates();
        template = await select<MigrationTemplate>({
          message: 'Template:',
          choices: templates.map((t) => ({
            value: t.value,
            name: `${t.label} - ${t.description}`,
          })),
        });
      }

      spinner.start();

      const result = await scaffoldMigration({
        name,
        type,
        outputDir: options.output,
        template,
      });

      const ctx = getOutputContext();
      if (ctx.jsonMode) {
        outputJson<ScaffoldJsonOutput>({
          success: result.success,
          kind: 'migration',
          type: result.type,
          filePath: result.filePath,
          fileName: result.fileName,
          error: result.error,
        });
        if (!result.success) process.exit(1);
        return;
      }

      if (!result.success) {
        spinner.fail(result.error || 'Failed to generate migration');
        process.exit(1);
      }

      spinner.succeed('Migration generated');
      console.log('\n' + success(`Created: ${dim(result.filePath)}`));
      console.log(dim('\nNext steps:'));
      console.log(dim('  1. Edit the migration file with your SQL'));
      if (type === 'tenant') {
        console.log(dim('  2. Run: npx drizzle-multitenant migrate --all'));
      } else {
        console.log(dim('  2. Run: npx drizzle-multitenant migrate:shared'));
      }
    } catch (err) {
      spinner.fail('Failed to generate migration');
      handleError(err);
    }
  });

/**
 * Main scaffold command (umbrella)
 */
export const scaffoldCommand = new Command('scaffold')
  .description('Scaffold boilerplate code for schemas, seeds, and migrations')
  .addHelpText(
    'after',
    `
Available scaffold commands:
  scaffold:schema    Generate a new Drizzle schema file
  scaffold:seed      Generate a new seed file
  scaffold:migration Generate a new migration file with template

Examples:
  $ drizzle-multitenant scaffold:schema orders --type=tenant
  $ drizzle-multitenant scaffold:seed initial --type=tenant
  $ drizzle-multitenant scaffold:migration add-orders --type=tenant

Use "drizzle-multitenant scaffold:<type> --help" for more information.
`
  )
  .action(() => {
    scaffoldCommand.help();
  });
