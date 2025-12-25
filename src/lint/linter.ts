/**
 * Schema Linter
 *
 * Main linter class that orchestrates schema validation using configured rules.
 */

import type {
  LintRules,
  LintResult,
  LintFileResult,
  LintIssue,
  LintRule,
  RuleConfig,
  RuleContext,
  SchemaTable,
  LinterOptions,
  LintSeverity,
} from './types.js';
import { DEFAULT_LINT_RULES } from './types.js';
import { allRules } from './rules/index.js';
import { parseSchemaModule, findSchemaFiles, loadSchemaFile, parseRawTable } from './parser.js';

/**
 * Get severity from rule config
 */
function getSeverity(config: RuleConfig<Record<string, unknown>> | undefined): LintSeverity {
  if (!config) return 'off';
  if (typeof config === 'string') return config;
  return config[0];
}

/**
 * Get options from rule config
 */
function getOptions(config: RuleConfig<Record<string, unknown>> | undefined): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === 'string') return {};
  return (config[1] as Record<string, unknown>) ?? {};
}

/**
 * Schema Linter
 *
 * Validates Drizzle ORM schemas against configurable rules.
 *
 * @example
 * ```typescript
 * const linter = new SchemaLinter({
 *   rules: {
 *     'table-naming': ['error', { style: 'snake_case' }],
 *     'require-primary-key': 'error',
 *     'prefer-uuid-pk': 'warn',
 *   },
 * });
 *
 * const result = await linter.lintDirectory('./src/db/schema');
 * console.log(result.passed ? 'All good!' : 'Issues found');
 * ```
 */
export class SchemaLinter {
  private rules: Map<string, LintRule> = new Map();
  private config: LintRules;

  constructor(options?: Partial<LinterOptions>) {
    // Merge with defaults
    this.config = {
      ...DEFAULT_LINT_RULES,
      ...options?.rules,
    };

    // Register all built-in rules
    for (const rule of allRules) {
      this.rules.set(rule.name, rule);
    }
  }

  /**
   * Get the effective severity for a rule
   */
  getEffectiveSeverity(ruleName: string): LintSeverity {
    const ruleConfig = (this.config as Record<string, RuleConfig<Record<string, unknown>> | undefined>)[ruleName];
    return getSeverity(ruleConfig);
  }

  /**
   * Get the options for a rule
   */
  getRuleOptions(ruleName: string): Record<string, unknown> {
    const ruleConfig = (this.config as Record<string, RuleConfig<Record<string, unknown>> | undefined>)[ruleName];
    return getOptions(ruleConfig);
  }

  /**
   * Check if a rule is enabled
   */
  isRuleEnabled(ruleName: string): boolean {
    return this.getEffectiveSeverity(ruleName) !== 'off';
  }

  /**
   * Lint a single table
   */
  lintTable(table: SchemaTable): LintIssue[] {
    const issues: LintIssue[] = [];

    for (const [ruleName, rule] of this.rules) {
      const severity = this.getEffectiveSeverity(ruleName);
      if (severity === 'off') continue;

      const options = this.getRuleOptions(ruleName);

      const context: RuleContext = {
        severity: severity as 'warn' | 'error',
        options,
        report: (issue) => {
          issues.push({
            rule: ruleName,
            severity: severity as 'warn' | 'error',
            ...issue,
          });
        },
      };

      // Run table-level validation
      if (rule.validateTable) {
        rule.validateTable(table, context);
      }

      // Run column-level validation
      if (rule.validateColumn) {
        for (const column of table.columns) {
          rule.validateColumn(column, table, context);
        }
      }
    }

    return issues;
  }

  /**
   * Lint multiple tables
   */
  lintTables(tables: SchemaTable[]): LintResult {
    const startTime = Date.now();
    const fileResults = new Map<string, LintFileResult>();

    // Group tables by file
    for (const table of tables) {
      if (!fileResults.has(table.filePath)) {
        fileResults.set(table.filePath, {
          filePath: table.filePath,
          issues: [],
          tables: 0,
          columns: 0,
        });
      }

      const fileResult = fileResults.get(table.filePath)!;
      fileResult.tables++;
      fileResult.columns += table.columns.length;

      // Lint the table
      const issues = this.lintTable(table);
      fileResult.issues.push(...issues);
    }

    // Run schema-level validation
    for (const [ruleName, rule] of this.rules) {
      if (!rule.validateSchema) continue;

      const severity = this.getEffectiveSeverity(ruleName);
      if (severity === 'off') continue;

      const options = this.getRuleOptions(ruleName);

      const context: RuleContext = {
        severity: severity as 'warn' | 'error',
        options,
        report: (issue) => {
          // Add to the appropriate file or create a general result
          const targetFile = issue.filePath || 'schema';
          if (!fileResults.has(targetFile)) {
            fileResults.set(targetFile, {
              filePath: targetFile,
              issues: [],
              tables: 0,
              columns: 0,
            });
          }

          fileResults.get(targetFile)!.issues.push({
            rule: ruleName,
            severity: severity as 'warn' | 'error',
            ...issue,
          });
        },
      };

      rule.validateSchema(tables, context);
    }

    // Calculate summary
    const files = Array.from(fileResults.values());
    const allIssues = files.flatMap((f) => f.issues);

    const summary = {
      totalFiles: files.length,
      totalTables: files.reduce((sum, f) => sum + f.tables, 0),
      totalColumns: files.reduce((sum, f) => sum + f.columns, 0),
      errors: allIssues.filter((i) => i.severity === 'error').length,
      warnings: allIssues.filter((i) => i.severity === 'warn').length,
    };

    return {
      files,
      summary,
      durationMs: Date.now() - startTime,
      passed: summary.errors === 0,
    };
  }

  /**
   * Lint a schema module (object with table exports)
   */
  lintModule(
    module: Record<string, unknown>,
    filePath: string,
    schemaType: 'tenant' | 'shared' = 'tenant'
  ): LintResult {
    const tables = parseSchemaModule(module, filePath, schemaType);
    return this.lintTables(tables);
  }

  /**
   * Lint schema files in a directory
   */
  async lintDirectory(
    dir: string,
    type: 'tenant' | 'shared' = 'tenant'
  ): Promise<LintResult> {
    const startTime = Date.now();
    const schemaFiles = await findSchemaFiles(dir, type);

    const allTables: SchemaTable[] = [];

    for (const fileInfo of schemaFiles) {
      const tables = await loadSchemaFile(fileInfo.filePath, fileInfo.type);
      allTables.push(...tables);
    }

    const result = this.lintTables(allTables);
    result.durationMs = Date.now() - startTime;

    return result;
  }

  /**
   * Lint multiple directories (tenant and shared)
   */
  async lintDirectories(options: {
    tenant?: string;
    shared?: string;
  }): Promise<LintResult> {
    const startTime = Date.now();
    const allTables: SchemaTable[] = [];

    if (options.tenant) {
      const schemaFiles = await findSchemaFiles(options.tenant, 'tenant');
      for (const fileInfo of schemaFiles) {
        const tables = await loadSchemaFile(fileInfo.filePath, fileInfo.type);
        allTables.push(...tables);
      }
    }

    if (options.shared) {
      const schemaFiles = await findSchemaFiles(options.shared, 'shared');
      for (const fileInfo of schemaFiles) {
        const tables = await loadSchemaFile(fileInfo.filePath, fileInfo.type);
        allTables.push(...tables);
      }
    }

    const result = this.lintTables(allTables);
    result.durationMs = Date.now() - startTime;

    return result;
  }

  /**
   * Get all registered rules
   */
  getRules(): LintRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get a specific rule by name
   */
  getRule(name: string): LintRule | undefined {
    return this.rules.get(name);
  }

  /**
   * Register a custom rule
   */
  registerRule(rule: LintRule): void {
    this.rules.set(rule.name, rule);
  }

  /**
   * Update rule configuration
   */
  setRuleConfig(ruleName: string, config: RuleConfig): void {
    (this.config as Record<string, RuleConfig>)[ruleName] = config;
  }

  /**
   * Get current configuration
   */
  getConfig(): LintRules {
    return { ...this.config };
  }
}

/**
 * Create a linter instance with configuration
 */
export function createLinter(options?: Partial<LinterOptions>): SchemaLinter {
  return new SchemaLinter(options);
}

/**
 * Quick lint function for simple use cases
 */
export async function lintSchemas(options: {
  tenant?: string;
  shared?: string;
  rules?: LintRules;
}): Promise<LintResult> {
  const linter = createLinter(options.rules ? { rules: options.rules } : undefined);

  const dirs: { tenant?: string; shared?: string } = {};
  if (options.tenant) dirs.tenant = options.tenant;
  if (options.shared) dirs.shared = options.shared;

  return linter.lintDirectories(dirs);
}

// Re-export parseRawTable for testing
export { parseRawTable };
