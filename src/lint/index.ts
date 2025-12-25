/**
 * Schema Linting Module
 *
 * Provides schema validation and linting capabilities for Drizzle ORM schemas.
 *
 * @example
 * ```typescript
 * import { createLinter, lintSchemas } from 'drizzle-multitenant/lint';
 *
 * // Quick lint
 * const result = await lintSchemas({
 *   tenant: './src/db/schema/tenant',
 *   shared: './src/db/schema/shared',
 *   rules: {
 *     'table-naming': ['error', { style: 'snake_case' }],
 *     'require-primary-key': 'error',
 *   },
 * });
 *
 * // Or use the linter class
 * const linter = createLinter({
 *   rules: {
 *     'prefer-uuid-pk': 'warn',
 *     'index-foreign-keys': 'warn',
 *   },
 * });
 *
 * const result = await linter.lintDirectory('./src/db/schema');
 * ```
 */

// Main linter
export { SchemaLinter, createLinter, lintSchemas, parseRawTable } from './linter.js';

// Reporter
export { formatLintResult, createReporter, printLintResult } from './reporter.js';

// Parser
export {
  parseSchemaModule,
  findSchemaFiles,
  loadSchemaFile,
} from './parser.js';

// Rules
export {
  allRules,
  getRuleByName,
  getAllRuleNames,
  tableNamingRule,
  columnNamingRule,
  namingRules,
  requirePrimaryKeyRule,
  preferUuidPkRule,
  requireTimestampsRule,
  indexForeignKeysRule,
  conventionRules,
  noCascadeDeleteRule,
  requireSoftDeleteRule,
  securityRules,
} from './rules/index.js';

// Types
export type {
  LintSeverity,
  NamingStyle,
  RuleConfig,
  NamingRuleOptions,
  LintConfig,
  LintRules,
  SchemaColumn,
  SchemaIndex,
  SchemaTable,
  ParsedSchema,
  LintIssue,
  LintFileResult,
  LintResult,
  ReporterFormat,
  ReporterOptions,
  RuleContext,
  LintRule,
  SchemaFileInfo,
  LinterOptions,
} from './types.js';

export { DEFAULT_LINT_RULES } from './types.js';
