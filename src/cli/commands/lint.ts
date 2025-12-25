import { Command } from 'commander';
import { resolve } from 'node:path';
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
  warning,
  bold,
  dim,
  cyan,
  green,
  yellow,
  red,
} from '../utils/output.js';
import { createLinter, formatLintResult } from '../../lint/index.js';
import type { GlobalOptions, LintJsonOutput, LintOptions } from '../types.js';
import type { LintResult, LintRules, ReporterFormat } from '../../lint/types.js';

/**
 * Lint command - validate schemas against rules
 */
export const lintCommand = new Command('lint')
  .description('Validate schemas against configurable rules')
  .option('-c, --config <path>', 'Path to config file')
  .option('--tenant-schema <path>', 'Path to tenant schema directory')
  .option('--shared-schema <path>', 'Path to shared schema directory')
  .option('--format <format>', 'Output format: console, json, github', 'console')
  .option('--fix', 'Attempt to fix issues automatically (not implemented)')
  .option('--rule <rules...>', 'Enable specific rules (e.g., --rule require-primary-key)')
  .option('--ignore-rule <rules...>', 'Disable specific rules')
  .addHelpText(
    'after',
    `
Examples:
  $ drizzle-multitenant lint
  $ drizzle-multitenant lint --json
  $ drizzle-multitenant lint --format=github
  $ drizzle-multitenant lint --tenant-schema=./src/db/schema/tenant
  $ drizzle-multitenant lint --rule require-primary-key prefer-uuid-pk
  $ drizzle-multitenant lint --ignore-rule require-timestamps

Available Rules:
  Naming:
    table-naming         Enforce table naming convention (snake_case by default)
    column-naming        Enforce column naming convention (snake_case by default)

  Conventions:
    require-primary-key  Require every table to have a primary key
    prefer-uuid-pk       Prefer UUID over serial/integer for primary keys
    require-timestamps   Require created_at/updated_at columns
    index-foreign-keys   Require indexes on foreign key columns

  Security:
    no-cascade-delete    Warn about CASCADE DELETE on foreign keys
    require-soft-delete  Require soft delete column on tables
`
  )
  .action(async (options: LintOptions) => {
    const ctx = getOutputContext();
    const spinner = createSpinner('Linting schemas...');
    const startTime = Date.now();

    try {
      // Load configuration
      let tenantSchemaDir: string | undefined;
      let sharedSchemaDir: string | undefined;
      let configRules: LintRules | undefined;

      if (options.tenantSchema) {
        tenantSchemaDir = resolve(process.cwd(), options.tenantSchema);
      }

      if (options.sharedSchema) {
        sharedSchemaDir = resolve(process.cwd(), options.sharedSchema);
      }

      // Try to load config for schema paths and rules
      try {
        const loaded = await loadConfig(options.config);

        // Get schema directories from config if not specified
        if (!tenantSchemaDir && loaded.config.schemas.tenant) {
          // Try to infer from config - look for common paths
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

        // Get lint rules from config
        if ((loaded.config as Record<string, unknown>).lint) {
          const lintConfig = (loaded.config as Record<string, unknown>).lint as {
            rules?: LintRules;
          };
          configRules = lintConfig.rules;
        }
      } catch {
        // Config not found, that's ok - use CLI options
      }

      // Build rules from CLI options
      const rules: LintRules = { ...configRules };

      // Enable specific rules via --rule
      if (options.rule) {
        for (const ruleName of options.rule) {
          (rules as Record<string, unknown>)[ruleName] = 'error';
        }
      }

      // Disable rules via --ignore-rule
      if (options.ignoreRule) {
        for (const ruleName of options.ignoreRule) {
          (rules as Record<string, unknown>)[ruleName] = 'off';
        }
      }

      // Check if we have any schema directories
      if (!tenantSchemaDir && !sharedSchemaDir) {
        spinner.fail('No schema directories found');
        log('');
        log('Specify schema directories using:');
        log('  --tenant-schema <path>  Path to tenant schema directory');
        log('  --shared-schema <path>  Path to shared schema directory');
        log('');
        log('Or create schemas in one of these locations:');
        log('  ./src/db/schema/tenant');
        log('  ./src/db/schema/shared');
        process.exit(1);
      }

      spinner.start();

      // Create linter
      const linter = createLinter({ rules });

      // Lint directories
      const result = await linter.lintDirectories({
        tenant: tenantSchemaDir,
        shared: sharedSchemaDir,
      });

      spinner.stop();

      // Handle output format
      const format = (options.format ?? 'console') as ReporterFormat;

      if (ctx.jsonMode || format === 'json') {
        const jsonOutput: LintJsonOutput = {
          passed: result.passed,
          summary: result.summary,
          files: result.files,
          durationMs: result.durationMs,
        };
        outputJson(jsonOutput);
      } else if (format === 'github') {
        // GitHub Actions format
        const output = formatLintResult(result, {
          format: 'github',
          colors: false,
        });
        console.log(output);
      } else {
        // Console format
        const output = formatLintResult(result, {
          format: 'console',
          colors: !options.noColor,
          verbose: options.verbose,
        });
        console.log(output);
      }

      // Exit with error code if there are errors
      if (!result.passed) {
        process.exit(1);
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      handleError(err);
    }
  });
