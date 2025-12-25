import { Command } from 'commander';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadConfig,
  createSpinner,
  success,
  dim,
} from '../utils/index.js';

export const generateSharedCommand = new Command('generate:shared')
  .description('Generate a new shared schema migration file')
  .requiredOption('-n, --name <name>', 'Migration name')
  .option('-c, --config <path>', 'Path to config file')
  .option('--migrations-folder <path>', 'Path to shared migrations folder')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant generate:shared --name=add-plans-table
  $ drizzle-multitenant generate:shared -n create-roles
  $ drizzle-multitenant generate:shared --name add-permissions --migrations-folder=./drizzle/shared

Alias for: drizzle-multitenant generate --name <name> --type shared
`)
  .action(async (options) => {
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { sharedMigrationsFolder: configFolder } = await loadConfig(options.config);

      const cwd = process.cwd();
      let folder: string;

      if (options.migrationsFolder) {
        folder = resolve(cwd, options.migrationsFolder);
      } else if (configFolder) {
        folder = resolve(cwd, configFolder);
      } else {
        folder = resolve(cwd, './drizzle/shared-migrations');
      }

      // Ensure folder exists
      if (!existsSync(folder)) {
        await mkdir(folder, { recursive: true });
        spinner.text = `Created shared migrations folder: ${folder}`;
      }

      spinner.text = 'Generating shared migration...';

      // Get next sequence number
      const files = existsSync(folder) ? await readdir(folder) : [];
      const sqlFiles = files.filter((f) => f.endsWith('.sql'));

      let maxSequence = 0;
      for (const file of sqlFiles) {
        const match = file.match(/^(\d+)_/);
        if (match?.[1]) {
          const seq = parseInt(match[1], 10);
          if (seq > maxSequence) {
            maxSequence = seq;
          }
        }
      }

      const nextSequence = (maxSequence + 1).toString().padStart(4, '0');
      const safeName = options.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

      const fileName = `${nextSequence}_${safeName}.sql`;
      const filePath = join(folder, fileName);

      // Create migration file with template
      const template = `-- Migration: ${options.name}
-- Created at: ${new Date().toISOString()}
-- Type: shared (public schema)

-- Write your SQL migration here
-- These tables will be shared across all tenants

`;

      await writeFile(filePath, template, 'utf-8');

      spinner.succeed('Shared migration generated');

      console.log('\n' + success(`Created: ${dim(filePath)}`));
      console.log(dim('\nEdit this file to add your shared schema migration SQL.'));
      console.log(dim('Run `drizzle-multitenant migrate:shared` to apply.'));
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
