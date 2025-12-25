import { Command } from 'commander';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadConfig } from '../utils/config.js';
import { createSpinner } from '../utils/spinner.js';
import { handleError } from '../utils/errors.js';
import {
  getOutputContext,
  outputJson,
  log,
  success,
  error,
  cyan,
  dim,
  bold,
} from '../utils/output.js';
import { createSchemaExporter } from '../../export/index.js';
import type { ExportFormat, ExportOptions } from '../../export/types.js';
import type { GlobalOptions, ExportCommandOptions } from '../types.js';

/**
 * Export command - export schemas to various formats
 */
export const exportCommand = new Command('export')
  .description('Export schemas to JSON, TypeScript, or Mermaid ERD format')
  .option('-c, --config <path>', 'Path to config file')
  .option('--tenant-schema <path>', 'Path to tenant schema directory')
  .option('--shared-schema <path>', 'Path to shared schema directory')
  .option('-f, --format <format>', 'Output format: json, typescript, mermaid', 'json')
  .option('-o, --output <path>', 'Output file path (defaults to stdout)')
  .option('--project-name <name>', 'Project name for the export')
  .option('--include-metadata', 'Include metadata in JSON export')
  .option('--include-zod', 'Include Zod schemas in TypeScript export')
  .option('--no-insert-types', 'Exclude insert types from TypeScript export')
  .option('--no-select-types', 'Exclude select types from TypeScript export')
  .option('--mermaid-theme <theme>', 'Mermaid theme: default, dark, forest, neutral', 'default')
  .option('--include-indexes', 'Include indexes in Mermaid ERD')
  .option('--json-schema', 'Export as JSON Schema format instead of raw JSON')
  .addHelpText(
    'after',
    `
Examples:
  # Export to JSON (stdout)
  $ drizzle-multitenant export

  # Export to TypeScript types
  $ drizzle-multitenant export --format=typescript -o schemas.d.ts

  # Export as Mermaid ERD
  $ drizzle-multitenant export --format=mermaid -o erd.md

  # Export with Zod schemas
  $ drizzle-multitenant export --format=typescript --include-zod

  # Export as JSON Schema
  $ drizzle-multitenant export --json-schema

  # Export specific directories
  $ drizzle-multitenant export --tenant-schema=./src/db/tenant --shared-schema=./src/db/shared

Output Formats:
  json        Raw JSON with table definitions (default)
  typescript  TypeScript type definitions
  mermaid     Mermaid ERD diagram
`
  )
  .action(async (options: ExportCommandOptions) => {
    const ctx = getOutputContext();
    const spinner = createSpinner('Exporting schemas...');

    try {
      // Load configuration for schema paths
      let tenantSchemaDir: string | undefined;
      let sharedSchemaDir: string | undefined;

      if (options.tenantSchema) {
        tenantSchemaDir = resolve(process.cwd(), options.tenantSchema);
      }

      if (options.sharedSchema) {
        sharedSchemaDir = resolve(process.cwd(), options.sharedSchema);
      }

      // Try to load config for schema paths
      try {
        const loaded = await loadConfig(options.config);

        if (!tenantSchemaDir && loaded.config.schemas.tenant) {
          const commonPaths = [
            './src/db/schema/tenant',
            './src/schema/tenant',
            './drizzle/schema/tenant',
            './db/schema/tenant',
          ];

          for (const path of commonPaths) {
            const resolved = resolve(process.cwd(), path);
            if (existsSync(resolved)) {
              tenantSchemaDir = resolved;
              break;
            }
          }
        }

        if (!sharedSchemaDir && loaded.config.schemas.shared) {
          const commonPaths = [
            './src/db/schema/shared',
            './src/schema/shared',
            './drizzle/schema/shared',
            './db/schema/shared',
          ];

          for (const path of commonPaths) {
            const resolved = resolve(process.cwd(), path);
            if (existsSync(resolved)) {
              sharedSchemaDir = resolved;
              break;
            }
          }
        }
      } catch {
        // Config not found, that's ok - use CLI options
      }

      // Check if we have any schema directories
      if (!tenantSchemaDir && !sharedSchemaDir) {
        if (!ctx.jsonMode) {
          spinner.fail('No schema directories found');
          log('');
          log('Specify schema directories using:');
          log('  --tenant-schema <path>  Path to tenant schema directory');
          log('  --shared-schema <path>  Path to shared schema directory');
          log('');
          log('Or create schemas in one of these locations:');
          log('  ./src/db/schema/tenant');
          log('  ./src/db/schema/shared');
        } else {
          outputJson({
            success: false,
            error: 'No schema directories found',
          });
        }
        process.exit(1);
      }

      if (!ctx.jsonMode) {
        spinner.start();
      }

      // Create exporter
      const exporter = createSchemaExporter();

      // Build export options
      const format = (options.format ?? 'json') as ExportFormat;
      const exportOptions: ExportOptions = {
        format,
        projectName: options.projectName,
        includeMetadata: options.includeMetadata,
        typescript: {
          includeZod: options.includeZod,
          includeInsertTypes: options.insertTypes !== false,
          includeSelectTypes: options.selectTypes !== false,
        },
        mermaid: {
          theme: options.mermaidTheme as 'default' | 'dark' | 'forest' | 'neutral',
          includeIndexes: options.includeIndexes,
          includeDataTypes: true,
          showPrimaryKeys: true,
          showForeignKeys: true,
        },
      };

      // Export schemas
      let output: string;

      if (options.jsonSchema && format === 'json') {
        // Export as JSON Schema format
        const result = await exporter.exportFromDirectories(
          { tenantDir: tenantSchemaDir, sharedDir: sharedSchemaDir },
          { ...exportOptions, format: 'json' }
        );
        const tables = JSON.parse(result).tables;
        output = exporter.exportToJsonSchema(tables, exportOptions);
      } else {
        output = await exporter.exportFromDirectories(
          { tenantDir: tenantSchemaDir, sharedDir: sharedSchemaDir },
          exportOptions
        );
      }

      if (!ctx.jsonMode) {
        spinner.stop();
      }

      // Handle output
      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, output, 'utf-8');

        if (ctx.jsonMode) {
          outputJson({
            success: true,
            outputFile: outputPath,
            format,
          });
        } else {
          success(`Exported schemas to ${cyan(outputPath)}`);
        }
      } else {
        // Output to stdout
        if (ctx.jsonMode && format !== 'json') {
          outputJson({
            success: true,
            format,
            content: output,
          });
        } else {
          console.log(output);
        }
      }
    } catch (err) {
      if (!ctx.jsonMode) {
        spinner.fail((err as Error).message);
      }
      handleError(err);
    }
  });
