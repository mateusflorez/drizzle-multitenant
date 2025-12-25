/**
 * Schema Linting Module Types
 *
 * Provides type definitions for schema validation and linting.
 */

/**
 * Severity level for lint rules
 */
export type LintSeverity = 'off' | 'warn' | 'error';

/**
 * Naming style options
 */
export type NamingStyle = 'snake_case' | 'camelCase' | 'PascalCase' | 'kebab-case';

/**
 * Rule configuration - can be severity only or [severity, options]
 */
export type RuleConfig<TOptions = Record<string, unknown>> =
  | LintSeverity
  | [LintSeverity, TOptions];

/**
 * Naming rule options
 */
export interface NamingRuleOptions {
  style: NamingStyle;
  /** Allow exceptions matching these patterns */
  exceptions?: string[];
}

/**
 * Lint configuration for defineConfig
 */
export interface LintConfig {
  rules: LintRules;
  /** Glob patterns to include */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Custom rules directory */
  customRulesDir?: string;
}

/**
 * All available lint rules
 */
export interface LintRules {
  // Naming conventions
  'table-naming'?: RuleConfig<NamingRuleOptions>;
  'column-naming'?: RuleConfig<NamingRuleOptions>;

  // Best practices
  'require-primary-key'?: RuleConfig;
  'prefer-uuid-pk'?: RuleConfig;
  'require-timestamps'?: RuleConfig<{ columns?: string[] }>;
  'index-foreign-keys'?: RuleConfig;

  // Security
  'no-cascade-delete'?: RuleConfig;
  'require-soft-delete'?: RuleConfig<{ column?: string }>;
}

/**
 * Default lint rules configuration
 */
export const DEFAULT_LINT_RULES: LintRules = {
  'table-naming': ['warn', { style: 'snake_case' }],
  'column-naming': ['warn', { style: 'snake_case' }],
  'require-primary-key': 'error',
  'prefer-uuid-pk': 'warn',
  'require-timestamps': 'off',
  'index-foreign-keys': 'warn',
  'no-cascade-delete': 'off',
  'require-soft-delete': 'off',
};

/**
 * Represents a column in a schema
 */
export interface SchemaColumn {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  hasDefault: boolean;
  defaultValue?: string | null | undefined;
  references?: {
    table: string;
    column: string;
    onDelete?: string | undefined;
    onUpdate?: string | undefined;
  } | undefined;
}

/**
 * Represents an index in a schema
 */
export interface SchemaIndex {
  name: string;
  columns: string[];
  isUnique: boolean;
}

/**
 * Represents a table in a schema
 */
export interface SchemaTable {
  name: string;
  schemaType: 'tenant' | 'shared';
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  filePath: string;
}

/**
 * Parsed schema info for linting
 */
export interface ParsedSchema {
  tables: SchemaTable[];
  filePath: string;
}

/**
 * A single lint issue
 */
export interface LintIssue {
  /** Rule that triggered this issue */
  rule: string;
  /** Severity level */
  severity: 'warn' | 'error';
  /** Human-readable message */
  message: string;
  /** File path where issue was found */
  filePath: string;
  /** Table name (if applicable) */
  table?: string;
  /** Column name (if applicable) */
  column?: string;
  /** Line number (if available) */
  line?: number;
  /** Suggestion to fix the issue */
  suggestion?: string;
}

/**
 * Result of linting a single schema file
 */
export interface LintFileResult {
  filePath: string;
  issues: LintIssue[];
  tables: number;
  columns: number;
}

/**
 * Aggregate result of linting all schemas
 */
export interface LintResult {
  /** All file results */
  files: LintFileResult[];
  /** Total issues by severity */
  summary: {
    totalFiles: number;
    totalTables: number;
    totalColumns: number;
    errors: number;
    warnings: number;
  };
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether linting passed (no errors) */
  passed: boolean;
}

/**
 * Output format for reporters
 */
export type ReporterFormat = 'console' | 'json' | 'github';

/**
 * Reporter options
 */
export interface ReporterOptions {
  format: ReporterFormat;
  /** Show only issues (no summary) */
  quiet?: boolean;
  /** Show detailed output */
  verbose?: boolean;
  /** Use colors in output */
  colors?: boolean;
}

/**
 * Rule context passed to rule implementations
 */
export interface RuleContext {
  /** Report an issue */
  report: (issue: Omit<LintIssue, 'rule' | 'severity'>) => void;
  /** Current severity for this rule */
  severity: 'warn' | 'error';
  /** Rule options (if any) */
  options: Record<string, unknown>;
}

/**
 * Rule implementation interface
 */
export interface LintRule {
  /** Rule name */
  name: string;
  /** Rule description */
  description: string;
  /** Default severity */
  defaultSeverity: LintSeverity;
  /** Validate a table */
  validateTable?: (table: SchemaTable, context: RuleContext) => void;
  /** Validate a column */
  validateColumn?: (column: SchemaColumn, table: SchemaTable, context: RuleContext) => void;
  /** Validate the entire schema */
  validateSchema?: (tables: SchemaTable[], context: RuleContext) => void;
}

/**
 * Schema file detection result
 */
export interface SchemaFileInfo {
  filePath: string;
  type: 'tenant' | 'shared';
}

/**
 * Linter options
 */
export interface LinterOptions {
  /** Schema directories to lint */
  schemaDirs?: {
    tenant?: string;
    shared?: string;
  };
  /** Glob patterns for schema files */
  include?: string[];
  /** Glob patterns to exclude */
  exclude?: string[];
  /** Rules configuration */
  rules?: LintRules;
}
