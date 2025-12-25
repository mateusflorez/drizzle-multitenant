import { Command } from 'commander';
import { resolve, relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createSpinner } from '../utils/spinner.js';
import { handleError } from '../utils/errors.js';
import {
  getOutputContext,
  outputJson,
  log,
  success,
  warning,
  error,
  cyan,
  dim,
  bold,
  green,
  yellow,
} from '../utils/output.js';
import { createSchemaImporter, loadSchemaExport } from '../../export/index.js';
import type { SchemaExport, ImportOptions, ImportResult } from '../../export/types.js';
import type { ImportCommandOptions } from '../types.js';

/**
 * Import command - import schemas from JSON and generate Drizzle files
 */
export const importCommand = new Command('import')
  .description('Import schemas from JSON and generate Drizzle schema files')
  .argument('<file>', 'Path to JSON schema file')
  .option('-o, --output <path>', 'Output directory for generated files', './src/db/schema')
  .option('--overwrite', 'Overwrite existing files')
  .option('--no-tenant', 'Skip tenant schema generation')
  .option('--no-shared', 'Skip shared schema generation')
  .option('--include-zod', 'Include Zod validation schemas')
  .option('--no-types', 'Skip TypeScript type generation')
  .option('--dry-run', 'Show what would be generated without writing files')
  .addHelpText(
    'after',
    `
Examples:
  # Import from JSON file
  $ drizzle-multitenant import schemas.json

  # Import to custom directory
  $ drizzle-multitenant import schemas.json -o ./db/schema

  # Import with Zod schemas
  $ drizzle-multitenant import schemas.json --include-zod

  # Overwrite existing files
  $ drizzle-multitenant import schemas.json --overwrite

  # Preview changes (dry run)
  $ drizzle-multitenant import schemas.json --dry-run

  # Import only tenant schemas
  $ drizzle-multitenant import schemas.json --no-shared

JSON File Format:
  The input file should be in the drizzle-multitenant export format:
  {
    "version": "1.0.0",
    "tables": [
      {
        "name": "users",
        "schemaType": "tenant",
        "columns": [...],
        "indexes": [...]
      }
    ]
  }

  You can generate this file using:
  $ drizzle-multitenant export > schemas.json
`
  )
  .action(async (file: string, options: ImportCommandOptions) => {
    const ctx = getOutputContext();
    const spinner = createSpinner('Importing schemas...');

    try {
      const inputPath = resolve(process.cwd(), file);

      if (!ctx.jsonMode) {
        log(`Reading schema file: ${cyan(relative(process.cwd(), inputPath))}`);
        spinner.start();
      }

      // Load schema export
      const schemaExport = await loadSchemaExport(inputPath);

      // Validate schema
      if (!schemaExport.tables || !Array.isArray(schemaExport.tables)) {
        throw new Error('Invalid schema file: missing tables array');
      }

      if (schemaExport.tables.length === 0) {
        throw new Error('Schema file contains no tables');
      }

      // Build import options
      const importOptions: ImportOptions = {
        outputDir: resolve(process.cwd(), options.output ?? './src/db/schema'),
        overwrite: options.overwrite,
        generateTenant: options.tenant !== false,
        generateShared: options.shared !== false,
        includeZod: options.includeZod,
        includeTypes: options.types !== false,
        dryRun: options.dryRun,
      };

      // Create importer
      const importer = createSchemaImporter();

      // Import schemas
      const result = await importer.import(schemaExport, importOptions);

      if (!ctx.jsonMode) {
        spinner.stop();
      }

      // Handle output
      if (ctx.jsonMode) {
        outputJson({
          success: result.success,
          dryRun: options.dryRun,
          filesCreated: result.filesCreated,
          filesSkipped: result.filesSkipped,
          errors: result.errors,
          summary: {
            created: result.filesCreated.length,
            skipped: result.filesSkipped.length,
            errors: result.errors.length,
          },
        });
      } else {
        log('');

        if (options.dryRun) {
          log(bold(yellow('Dry run - no files were written')));
          log('');
        }

        // Show created files
        if (result.filesCreated.length > 0) {
          log(bold(green(`${options.dryRun ? 'Would create' : 'Created'} ${result.filesCreated.length} file(s):`)));
          for (const file of result.filesCreated) {
            log(`  ${green('+')} ${relative(process.cwd(), file)}`);
          }
          log('');
        }

        // Show skipped files
        if (result.filesSkipped.length > 0) {
          log(bold(yellow(`Skipped ${result.filesSkipped.length} existing file(s):`)));
          for (const file of result.filesSkipped) {
            log(`  ${yellow('-')} ${relative(process.cwd(), file)}`);
          }
          log('');
          log(dim('Use --overwrite to replace existing files'));
          log('');
        }

        // Show errors
        if (result.errors.length > 0) {
          log(bold(error(`Errors (${result.errors.length}):`)));
          for (const err of result.errors) {
            log(`  ${relative(process.cwd(), err.file)}: ${err.error}`);
          }
          log('');
        }

        // Summary
        if (result.success) {
          success(`Import completed successfully`);
        } else {
          error('Import completed with errors');
        }

        // Show next steps
        if (result.filesCreated.length > 0 && !options.dryRun) {
          log('');
          log(bold('Next steps:'));
          log('  1. Review the generated schema files');
          log('  2. Uncomment and adjust foreign key references');
          log('  3. Add relations if needed');
          log('  4. Generate migrations: npx drizzle-multitenant generate');
        }
      }

      if (!result.success) {
        process.exit(1);
      }
    } catch (err) {
      if (!ctx.jsonMode) {
        spinner.fail((err as Error).message);
      }
      handleError(err);
    }
  });
