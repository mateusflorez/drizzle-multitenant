import { select, input, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MenuRenderer } from '../base/menu-renderer.js';
import { createLinter, allRules } from '../../../lint/index.js';
import type { MenuContext, ScreenAction } from '../types.js';
import type { LintResult, LintRules, LintIssue } from '../../../lint/types.js';

/**
 * Screen for schema linting
 */
export class LintScreen {
  private readonly renderer: MenuRenderer;
  private readonly ctx: MenuContext;

  constructor(ctx: MenuContext, renderer?: MenuRenderer) {
    this.ctx = ctx;
    this.renderer = renderer || new MenuRenderer();
  }

  /**
   * Show the lint screen
   */
  async show(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Schema Lint');

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Lint schemas with default rules', value: 'default' },
        { name: 'Configure rules and lint', value: 'configure' },
        { name: 'View available rules', value: 'rules' },
        { name: chalk.gray('← Back to main menu'), value: 'back' },
      ],
    });

    switch (action) {
      case 'default':
        return this.runLint();
      case 'configure':
        return this.configureAndLint();
      case 'rules':
        return this.showRules();
      default:
        return { type: 'back' };
    }
  }

  /**
   * Run lint with default rules
   */
  private async runLint(rules?: LintRules): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Linting Schemas...');

    // Try to find schema directories
    const { tenantDir, sharedDir } = await this.findSchemaDirectories();

    if (!tenantDir && !sharedDir) {
      this.renderer.showStatus('No schema directories found', 'error');
      console.log('');
      console.log('  Please specify schema directories or create them in:');
      console.log('    - ./src/db/schema/tenant');
      console.log('    - ./src/db/schema/shared');
      console.log('');
      await this.renderer.pressEnterToContinue();
      return this.show();
    }

    console.log(`  Tenant schemas: ${tenantDir ?? chalk.dim('not found')}`);
    console.log(`  Shared schemas: ${sharedDir ?? chalk.dim('not found')}`);
    console.log('');

    try {
      const linter = createLinter({ rules });
      const result = await linter.lintDirectories({
        tenant: tenantDir,
        shared: sharedDir,
      });

      return this.showResults(result);
    } catch (error) {
      this.renderer.showStatus((error as Error).message, 'error');
      await this.renderer.pressEnterToContinue();
      return this.show();
    }
  }

  /**
   * Find schema directories
   */
  private async findSchemaDirectories(): Promise<{
    tenantDir?: string;
    sharedDir?: string;
  }> {
    const commonPaths = {
      tenant: [
        './src/db/schema/tenant',
        './src/schema/tenant',
        './drizzle/schema/tenant',
        './db/schema/tenant',
      ],
      shared: [
        './src/db/schema/shared',
        './src/schema/shared',
        './drizzle/schema/shared',
        './db/schema/shared',
      ],
    };

    let tenantDir: string | undefined;
    let sharedDir: string | undefined;

    for (const path of commonPaths.tenant) {
      const resolved = resolve(process.cwd(), path);
      if (existsSync(resolved)) {
        tenantDir = resolved;
        break;
      }
    }

    for (const path of commonPaths.shared) {
      const resolved = resolve(process.cwd(), path);
      if (existsSync(resolved)) {
        sharedDir = resolved;
        break;
      }
    }

    return { tenantDir, sharedDir };
  }

  /**
   * Configure rules and run lint
   */
  private async configureAndLint(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Configure Lint Rules');

    // Select rules to enable
    const selectedRules = await checkbox({
      message: 'Select rules to enable:',
      choices: allRules.map((rule) => ({
        name: `${rule.name} - ${rule.description}`,
        value: rule.name,
        checked: rule.defaultSeverity !== 'off',
      })),
    });

    if (selectedRules.length === 0) {
      this.renderer.showStatus('No rules selected', 'warning');
      await this.renderer.pressEnterToContinue();
      return this.show();
    }

    // Select severity for selected rules
    const severity = await select({
      message: 'Default severity for selected rules:',
      choices: [
        { name: 'Error (fail on issues)', value: 'error' },
        { name: 'Warning (report but pass)', value: 'warn' },
      ],
    });

    // Build rules config
    const rules: LintRules = {};
    for (const ruleName of selectedRules) {
      (rules as Record<string, string>)[ruleName] = severity;
    }

    return this.runLint(rules);
  }

  /**
   * Show lint results
   */
  private async showResults(result: LintResult): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Lint Results');

    // Summary
    const { errors, warnings, totalTables, totalFiles } = result.summary;

    if (errors === 0 && warnings === 0) {
      console.log(chalk.green.bold('  ✓ All schemas passed validation!'));
      console.log('');
      console.log(`    Files:   ${totalFiles}`);
      console.log(`    Tables:  ${totalTables}`);
      console.log(`    Issues:  ${chalk.green('0')}`);
      console.log('');
      console.log(chalk.dim(`    Completed in ${result.durationMs}ms`));
    } else {
      // Show issues by file
      for (const fileResult of result.files) {
        if (fileResult.issues.length === 0) continue;

        console.log('');
        console.log(chalk.bold(fileResult.filePath));

        for (const issue of fileResult.issues) {
          this.printIssue(issue);
        }
      }

      // Summary
      console.log('');
      console.log(chalk.bold('  Summary:'));
      console.log(`    Files:    ${totalFiles}`);
      console.log(`    Tables:   ${totalTables}`);
      console.log(`    Errors:   ${errors > 0 ? chalk.red(errors.toString()) : chalk.green('0')}`);
      console.log(`    Warnings: ${warnings > 0 ? chalk.yellow(warnings.toString()) : chalk.green('0')}`);
      console.log('');
      console.log(chalk.dim(`    Completed in ${result.durationMs}ms`));

      // Overall status
      console.log('');
      if (!result.passed) {
        console.log(chalk.red.bold('  ✗ Schema validation failed'));
      } else {
        console.log(chalk.yellow.bold('  ⚠ Schema validation passed with warnings'));
      }
    }

    console.log('');

    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Run lint again', value: 'again' },
        { name: 'Configure rules and re-run', value: 'configure' },
        { name: 'View rule details', value: 'rules' },
        { name: chalk.gray('← Back to main menu'), value: 'back' },
      ],
    });

    switch (action) {
      case 'again':
        return this.runLint();
      case 'configure':
        return this.configureAndLint();
      case 'rules':
        return this.showRules();
      default:
        return { type: 'back' };
    }
  }

  /**
   * Print a single issue
   */
  private printIssue(issue: LintIssue): void {
    const icon = issue.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
    const severity = issue.severity === 'error' ? chalk.red('error') : chalk.yellow('warn');
    const rule = chalk.dim(`(${issue.rule})`);

    console.log(`    ${icon} ${severity}  ${issue.message} ${rule}`);

    if (issue.table) {
      const location = issue.column ? `${issue.table}.${issue.column}` : issue.table;
      console.log(chalk.dim(`             ${location}`));
    }

    if (issue.suggestion) {
      console.log(chalk.cyan(`             → ${issue.suggestion}`));
    }
  }

  /**
   * Show available rules
   */
  private async showRules(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Available Lint Rules');

    console.log(chalk.bold('  Naming Rules:'));
    console.log(`    ${chalk.cyan('table-naming')}     Enforce table naming convention`);
    console.log(`    ${chalk.cyan('column-naming')}    Enforce column naming convention`);

    console.log('');
    console.log(chalk.bold('  Convention Rules:'));
    console.log(`    ${chalk.cyan('require-primary-key')}   Require every table to have a PK`);
    console.log(`    ${chalk.cyan('prefer-uuid-pk')}        Prefer UUID over serial for PKs`);
    console.log(`    ${chalk.cyan('require-timestamps')}    Require created_at/updated_at`);
    console.log(`    ${chalk.cyan('index-foreign-keys')}    Require indexes on FK columns`);

    console.log('');
    console.log(chalk.bold('  Security Rules:'));
    console.log(`    ${chalk.cyan('no-cascade-delete')}     Warn about CASCADE DELETE`);
    console.log(`    ${chalk.cyan('require-soft-delete')}   Require soft delete column`);

    console.log('');
    console.log(chalk.dim('  Configure rules in tenant.config.ts:'));
    console.log(chalk.dim('    lint: {'));
    console.log(chalk.dim('      rules: {'));
    console.log(chalk.dim("        'table-naming': ['error', { style: 'snake_case' }],"));
    console.log(chalk.dim("        'require-primary-key': 'error',"));
    console.log(chalk.dim('      }'));
    console.log(chalk.dim('    }'));

    console.log('');

    await this.renderer.pressEnterToContinue();
    return this.show();
  }
}
