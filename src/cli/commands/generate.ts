import { Command } from 'commander';
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadConfig,
  createSpinner,
  success,
  error,
  dim,
} from '../utils/index.js';

export const generateCommand = new Command('generate')
  .description('Generate a new migration file')
  .requiredOption('-n, --name <name>', 'Migration name')
  .option('-c, --config <path>', 'Path to config file')
  .option('--type <type>', 'Migration type: tenant or shared', 'tenant')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .action(async (options) => {
    const spinner = createSpinner('Loading configuration...');

    try {
      spinner.start();

      const { migrationsFolder: configFolder } = await loadConfig(options.config);

      const cwd = process.cwd();
      let folder: string;

      if (options.migrationsFolder) {
        folder = resolve(cwd, options.migrationsFolder);
      } else if (configFolder) {
        folder = resolve(cwd, configFolder);
      } else {
        folder = resolve(cwd, options.type === 'shared' ? './drizzle/shared' : './drizzle/tenant');
      }

      // Ensure folder exists
      if (!existsSync(folder)) {
        await mkdir(folder, { recursive: true });
        spinner.text = `Created migrations folder: ${folder}`;
      }

      spinner.text = 'Generating migration...';

      // Get next sequence number
      const files = existsSync(folder) ? await readdir(folder) : [];
      const sqlFiles = files.filter((f) => f.endsWith('.sql'));

      let maxSequence = 0;
      for (const file of sqlFiles) {
        const match = file.match(/^(\d+)_/);
        if (match) {
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
-- Type: ${options.type}

-- Write your SQL migration here

`;

      await writeFile(filePath, template, 'utf-8');

      spinner.succeed('Migration generated');

      console.log('\n' + success(`Created: ${dim(filePath)}`));
      console.log(dim('\nEdit this file to add your migration SQL.'));
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
