import type { TableFormat } from '../migrator/table-format.js';

/**
 * JSON output for the status command
 */
export interface StatusJsonOutput {
  tenants: StatusTenantInfo[];
  summary: StatusSummary;
}

export interface StatusTenantInfo {
  id: string;
  schema: string;
  format: TableFormat | null;
  applied: number;
  pending: number;
  status: 'ok' | 'behind' | 'error';
  pendingMigrations: string[];
  error?: string | undefined;
}

export interface StatusSummary {
  total: number;
  upToDate: number;
  behind: number;
  error: number;
}

/**
 * JSON output for the migrate command
 */
export interface MigrateJsonOutput {
  results: MigrateTenantResult[];
  summary: MigrateSummary;
}

export interface MigrateTenantResult {
  tenantId: string;
  schema: string;
  success: boolean;
  appliedMigrations: string[];
  durationMs: number;
  format?: TableFormat | undefined;
  error?: string | undefined;
}

export interface MigrateSummary {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  durationMs: number;
  averageMs?: number | undefined;
}

/**
 * JSON output for the generate command
 */
export interface GenerateJsonOutput {
  file: string;
  name: string;
  type: 'tenant' | 'shared';
  path: string;
}

/**
 * JSON output for tenant:create command
 */
export interface TenantCreateJsonOutput {
  tenantId: string;
  schema: string;
  created: boolean;
  migrationsApplied: number;
  durationMs: number;
}

/**
 * JSON output for tenant:drop command
 */
export interface TenantDropJsonOutput {
  tenantId: string;
  schema: string;
  dropped: boolean;
  cascade: boolean;
}

/**
 * JSON output for convert-format command
 */
export interface ConvertFormatJsonOutput {
  results: ConvertFormatResult[];
  summary: {
    total: number;
    converted: number;
    failed: number;
    skipped: number;
  };
}

export interface ConvertFormatResult {
  tenantId: string;
  schema: string;
  fromFormat: TableFormat | null;
  toFormat: TableFormat;
  success: boolean;
  error?: string;
}

/**
 * Global CLI options that apply to all commands
 */
export interface GlobalOptions {
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

/**
 * Options for the migrate command
 */
export interface MigrateOptions extends GlobalOptions {
  config?: string;
  all?: boolean;
  tenant?: string;
  tenants?: string;
  concurrency?: string;
  dryRun?: boolean;
  markApplied?: boolean;
  migrationsFolder?: string;
}

/**
 * Options for the status command
 */
export interface StatusOptions extends GlobalOptions {
  config?: string;
  migrationsFolder?: string;
}

/**
 * Options for the generate command
 */
export interface GenerateOptions extends GlobalOptions {
  name: string;
  config?: string;
  type?: 'tenant' | 'shared';
  migrationsFolder?: string;
}

/**
 * Options for tenant:create command
 */
export interface TenantCreateOptions extends GlobalOptions {
  id: string;
  config?: string;
  migrationsFolder?: string;
  migrate?: boolean;
}

/**
 * Options for tenant:drop command
 */
export interface TenantDropOptions extends GlobalOptions {
  id: string;
  config?: string;
  migrationsFolder?: string;
  force?: boolean;
  cascade?: boolean;
}

/**
 * Options for convert-format command
 */
export interface ConvertFormatOptions extends GlobalOptions {
  to: TableFormat;
  config?: string;
  tenant?: string;
  dryRun?: boolean;
  migrationsFolder?: string;
}

/**
 * Options for the sync command
 */
export interface SyncOptions extends GlobalOptions {
  config?: string;
  status?: boolean;
  markMissing?: boolean;
  cleanOrphans?: boolean;
  concurrency?: string;
  migrationsFolder?: string;
}

/**
 * JSON output for the sync command
 */
export interface SyncJsonOutput {
  tenants: SyncTenantInfo[];
  summary: SyncSummary;
}

export interface SyncTenantInfo {
  id: string;
  schema: string;
  format: TableFormat | null;
  inSync: boolean;
  missing: string[];
  orphans: string[];
  error?: string | undefined;
}

export interface SyncSummary {
  total: number;
  inSync: number;
  outOfSync: number;
  error: number;
}

/**
 * Options for the diff command
 */
export interface DiffOptions extends GlobalOptions {
  config?: string;
  reference?: string;
  tenant?: string;
  tenants?: string;
  concurrency?: string;
  indexes?: boolean;
  constraints?: boolean;
  excludeTables?: string;
}

/**
 * JSON output for the diff command
 */
export interface DiffJsonOutput {
  referenceTenant: string;
  tenants: DiffTenantInfo[];
  summary: DiffSummary;
}

export interface DiffTenantInfo {
  id: string;
  schema: string;
  hasDrift: boolean;
  issueCount: number;
  tables: DiffTableInfo[];
  error?: string | undefined;
}

export interface DiffTableInfo {
  name: string;
  status: 'ok' | 'missing' | 'extra' | 'drifted';
  columns: DiffColumnInfo[];
  indexes: DiffIndexInfo[];
  constraints: DiffConstraintInfo[];
}

export interface DiffColumnInfo {
  column: string;
  type: 'missing' | 'extra' | 'type_mismatch' | 'nullable_mismatch' | 'default_mismatch';
  expected?: string | boolean | null;
  actual?: string | boolean | null;
  description: string;
}

export interface DiffIndexInfo {
  index: string;
  type: 'missing' | 'extra' | 'definition_mismatch';
  expected?: string;
  actual?: string;
  description: string;
}

export interface DiffConstraintInfo {
  constraint: string;
  type: 'missing' | 'extra' | 'definition_mismatch';
  expected?: string;
  actual?: string;
  description: string;
}

export interface DiffSummary {
  total: number;
  noDrift: number;
  withDrift: number;
  error: number;
  durationMs: number;
}

/**
 * JSON output for the doctor command
 */
export interface DoctorJsonOutput {
  healthy: boolean;
  checks: DoctorCheck[];
  recommendations: DoctorRecommendation[];
  database?: {
    version: string;
    latencyMs: number;
  };
  tenantCount?: number;
  poolConfig?: {
    maxPools: number;
    poolTtlMs: number;
  };
  durationMs: number;
}

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  details?: string;
}

export interface DoctorRecommendation {
  priority: 'high' | 'medium' | 'low';
  message: string;
  action?: string;
}

/**
 * Options for the doctor command
 */
export interface DoctorOptions extends GlobalOptions {
  config?: string;
}

/**
 * Options for the lint command
 */
export interface LintOptions extends GlobalOptions {
  config?: string;
  tenantSchema?: string;
  sharedSchema?: string;
  format?: 'console' | 'json' | 'github';
  fix?: boolean;
  rule?: string[];
  ignoreRule?: string[];
}

/**
 * JSON output for the lint command
 */
export interface LintJsonOutput {
  passed: boolean;
  summary: {
    totalFiles: number;
    totalTables: number;
    totalColumns: number;
    errors: number;
    warnings: number;
  };
  files: Array<{
    filePath: string;
    issues: Array<{
      rule: string;
      severity: 'warn' | 'error';
      message: string;
      filePath: string;
      table?: string;
      column?: string;
      line?: number;
      suggestion?: string;
    }>;
    tables: number;
    columns: number;
  }>;
  durationMs: number;
}

/**
 * Options for the export command
 */
export interface ExportCommandOptions extends GlobalOptions {
  config?: string;
  tenantSchema?: string;
  sharedSchema?: string;
  format?: 'json' | 'typescript' | 'mermaid';
  output?: string;
  projectName?: string;
  includeMetadata?: boolean;
  includeZod?: boolean;
  insertTypes?: boolean;
  selectTypes?: boolean;
  mermaidTheme?: string;
  includeIndexes?: boolean;
  jsonSchema?: boolean;
}

/**
 * Options for the import command
 */
export interface ImportCommandOptions extends GlobalOptions {
  output?: string;
  overwrite?: boolean;
  tenant?: boolean;
  shared?: boolean;
  includeZod?: boolean;
  types?: boolean;
  dryRun?: boolean;
}
