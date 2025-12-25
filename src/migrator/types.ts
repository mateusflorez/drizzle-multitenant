import type { TableFormat } from './table-format.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Seed function signature
 * Called with the tenant database instance and tenant ID
 *
 * @example
 * ```typescript
 * const seed: SeedFunction = async (db, tenantId) => {
 *   await db.insert(roles).values([
 *     { name: 'admin', permissions: ['*'] },
 *     { name: 'user', permissions: ['read'] },
 *   ]);
 * };
 * ```
 */
export type SeedFunction<TSchema extends Record<string, unknown> = Record<string, unknown>> = (
  db: PostgresJsDatabase<TSchema>,
  tenantId: string
) => Promise<void>;

/**
 * Seed result for a single tenant
 */
export interface TenantSeedResult {
  tenantId: string;
  schemaName: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

/**
 * Aggregate seed results
 */
export interface SeedResults {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: TenantSeedResult[];
}

/**
 * Options for seed operations
 */
export interface SeedOptions {
  /** Number of concurrent seed operations */
  concurrency?: number;
  /** Progress callback */
  onProgress?: (tenantId: string, status: 'starting' | 'seeding' | 'completed' | 'failed' | 'skipped') => void;
  /** Error handler */
  onError?: (tenantId: string, error: Error) => 'continue' | 'abort';
}

/**
 * Migration file metadata
 */
export interface MigrationFile {
  /** Migration file name */
  name: string;
  /** Full file path */
  path: string;
  /** SQL content */
  sql: string;
  /** Timestamp extracted from filename */
  timestamp: number;
  /** SHA-256 hash of file content (for drizzle-kit compatibility) */
  hash: string;
}

/**
 * Migration status for a tenant
 */
export interface TenantMigrationStatus {
  tenantId: string;
  schemaName: string;
  appliedCount: number;
  pendingCount: number;
  pendingMigrations: string[];
  status: 'ok' | 'behind' | 'error';
  error?: string;
  /** Detected table format (null for new tenants without migrations table) */
  format: TableFormat | null;
}

/**
 * Migration result for a single tenant
 */
export interface TenantMigrationResult {
  tenantId: string;
  schemaName: string;
  success: boolean;
  appliedMigrations: string[];
  error?: string;
  durationMs: number;
  /** Table format used for this migration */
  format?: TableFormat;
}

/**
 * Aggregate migration results
 */
export interface MigrationResults {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: TenantMigrationResult[];
}

/**
 * Progress callback for migrations
 */
export type MigrationProgressCallback = (
  tenantId: string,
  status: 'starting' | 'migrating' | 'completed' | 'failed' | 'skipped',
  migrationName?: string
) => void;

/**
 * Error handler for migrations
 */
export type MigrationErrorHandler = (
  tenantId: string,
  error: Error
) => 'continue' | 'abort';

/**
 * Migration hooks
 */
export interface MigrationHooks {
  /** Called before migrating a tenant */
  beforeTenant?: (tenantId: string) => void | Promise<void>;
  /** Called after migrating a tenant */
  afterTenant?: (tenantId: string, result: TenantMigrationResult) => void | Promise<void>;
  /** Called before applying a migration */
  beforeMigration?: (tenantId: string, migrationName: string) => void | Promise<void>;
  /** Called after applying a migration */
  afterMigration?: (tenantId: string, migrationName: string, durationMs: number) => void | Promise<void>;
}

/**
 * Migrator configuration
 */
export interface MigratorConfig {
  /** Path to tenant migrations folder */
  migrationsFolder: string;
  /** Table name for tracking migrations */
  migrationsTable?: string;
  /** Function to discover tenant IDs */
  tenantDiscovery: () => Promise<string[]>;
  /** Migration hooks */
  hooks?: MigrationHooks;
  /**
   * Table format for tracking migrations
   * - "auto": Auto-detect existing format, use defaultFormat for new tables
   * - "name": Use filename (drizzle-multitenant native)
   * - "hash": Use SHA-256 hash
   * - "drizzle-kit": Exact drizzle-kit format (hash + bigint timestamp)
   * @default "auto"
   */
  tableFormat?: 'auto' | TableFormat;
  /**
   * When using "auto" format and no table exists, which format to create
   * @default "name"
   */
  defaultFormat?: TableFormat;

  // ============================================================================
  // Shared Schema Migration Options
  // ============================================================================

  /**
   * Path to shared schema migrations folder
   * If provided, enables shared schema migration support
   */
  sharedMigrationsFolder?: string;
  /**
   * Table name for tracking shared migrations
   * @default "__drizzle_shared_migrations"
   */
  sharedMigrationsTable?: string;
  /**
   * Hooks for shared schema migrations
   */
  sharedHooks?: SharedMigrationHooks;
}

/**
 * Migrate options
 */
export interface MigrateOptions {
  /** Number of concurrent migrations */
  concurrency?: number;
  /** Progress callback */
  onProgress?: MigrationProgressCallback;
  /** Error handler */
  onError?: MigrationErrorHandler;
  /** Dry run mode */
  dryRun?: boolean;
}

/**
 * Tenant creation options
 */
export interface CreateTenantOptions {
  /** Apply all migrations after creating schema */
  migrate?: boolean;
}

/**
 * Tenant drop options
 */
export interface DropTenantOptions {
  /** Skip confirmation (force drop) */
  force?: boolean;
  /** Cascade drop */
  cascade?: boolean;
}

/**
 * Applied migration record
 */
export interface AppliedMigration {
  id: number;
  /** Migration identifier (name or hash depending on format) */
  identifier: string;
  /** Migration name (only available in name-based format) */
  name?: string;
  /** Migration hash (only available in hash-based format) */
  hash?: string;
  appliedAt: Date;
}

/**
 * Sync status for a single tenant
 */
export interface TenantSyncStatus {
  tenantId: string;
  schemaName: string;
  /** Migrations in disk but not tracked in database */
  missing: string[];
  /** Migrations tracked in database but not found in disk */
  orphans: string[];
  /** Whether the tenant is in sync */
  inSync: boolean;
  /** Table format used */
  format: TableFormat | null;
  /** Error if any */
  error?: string;
}

/**
 * Aggregate sync status
 */
export interface SyncStatus {
  total: number;
  inSync: number;
  outOfSync: number;
  error: number;
  details: TenantSyncStatus[];
}

/**
 * Sync result for a single tenant
 */
export interface TenantSyncResult {
  tenantId: string;
  schemaName: string;
  success: boolean;
  /** Migrations that were marked as applied */
  markedMigrations: string[];
  /** Orphan records that were removed */
  removedOrphans: string[];
  error?: string;
  durationMs: number;
}

/**
 * Aggregate sync results
 */
export interface SyncResults {
  total: number;
  succeeded: number;
  failed: number;
  details: TenantSyncResult[];
}

/**
 * Options for sync operations
 */
export interface SyncOptions {
  /** Number of concurrent operations */
  concurrency?: number;
  /** Progress callback */
  onProgress?: (tenantId: string, status: 'starting' | 'syncing' | 'completed' | 'failed') => void;
  /** Error handler */
  onError?: MigrationErrorHandler;
}

// ============================================================================
// Schema Drift Detection Types
// ============================================================================

/**
 * Column information from database introspection
 */
export interface ColumnInfo {
  /** Column name */
  name: string;
  /** PostgreSQL data type */
  dataType: string;
  /** Full data type (e.g., varchar(255)) */
  udtName: string;
  /** Whether column is nullable */
  isNullable: boolean;
  /** Default value expression */
  columnDefault: string | null;
  /** Character maximum length for varchar/char */
  characterMaximumLength: number | null;
  /** Numeric precision for numeric types */
  numericPrecision: number | null;
  /** Numeric scale for numeric types */
  numericScale: number | null;
  /** Ordinal position in table */
  ordinalPosition: number;
}

/**
 * Index information from database introspection
 */
export interface IndexInfo {
  /** Index name */
  name: string;
  /** Column names in the index */
  columns: string[];
  /** Whether index is unique */
  isUnique: boolean;
  /** Whether index is primary key */
  isPrimary: boolean;
  /** Index definition SQL */
  definition: string;
}

/**
 * Constraint information from database introspection
 */
export interface ConstraintInfo {
  /** Constraint name */
  name: string;
  /** Constraint type (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK) */
  type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK';
  /** Columns involved in constraint */
  columns: string[];
  /** Foreign table (for foreign keys) */
  foreignTable?: string;
  /** Foreign columns (for foreign keys) */
  foreignColumns?: string[];
  /** Check expression (for check constraints) */
  checkExpression?: string;
}

/**
 * Table schema information
 */
export interface TableSchema {
  /** Table name */
  name: string;
  /** Columns in the table */
  columns: ColumnInfo[];
  /** Indexes on the table */
  indexes: IndexInfo[];
  /** Constraints on the table */
  constraints: ConstraintInfo[];
}

/**
 * Full schema for a tenant
 */
export interface TenantSchema {
  /** Tenant ID */
  tenantId: string;
  /** Schema name */
  schemaName: string;
  /** Tables in the schema */
  tables: TableSchema[];
  /** Introspection timestamp */
  introspectedAt: Date;
}

/**
 * Column drift details
 */
export interface ColumnDrift {
  /** Column name */
  column: string;
  /** Type of drift */
  type: 'missing' | 'extra' | 'type_mismatch' | 'nullable_mismatch' | 'default_mismatch';
  /** Expected value (from reference) */
  expected?: string | boolean | null;
  /** Actual value (from tenant) */
  actual?: string | boolean | null;
  /** Human-readable description */
  description: string;
}

/**
 * Index drift details
 */
export interface IndexDrift {
  /** Index name */
  index: string;
  /** Type of drift */
  type: 'missing' | 'extra' | 'definition_mismatch';
  /** Expected definition */
  expected?: string;
  /** Actual definition */
  actual?: string;
  /** Human-readable description */
  description: string;
}

/**
 * Constraint drift details
 */
export interface ConstraintDrift {
  /** Constraint name */
  constraint: string;
  /** Type of drift */
  type: 'missing' | 'extra' | 'definition_mismatch';
  /** Expected details */
  expected?: string;
  /** Actual details */
  actual?: string;
  /** Human-readable description */
  description: string;
}

/**
 * Table drift details
 */
export interface TableDrift {
  /** Table name */
  table: string;
  /** Whether the entire table is missing or extra */
  status: 'ok' | 'missing' | 'extra' | 'drifted';
  /** Column drifts */
  columns: ColumnDrift[];
  /** Index drifts */
  indexes: IndexDrift[];
  /** Constraints drifts */
  constraints: ConstraintDrift[];
}

/**
 * Schema drift for a single tenant
 */
export interface TenantSchemaDrift {
  /** Tenant ID */
  tenantId: string;
  /** Schema name */
  schemaName: string;
  /** Whether schema has drift */
  hasDrift: boolean;
  /** Table-level drifts */
  tables: TableDrift[];
  /** Total number of issues */
  issueCount: number;
  /** Error if introspection failed */
  error?: string;
}

/**
 * Aggregate schema drift status
 */
export interface SchemaDriftStatus {
  /** Reference tenant used for comparison */
  referenceTenant: string;
  /** Total tenants checked */
  total: number;
  /** Tenants without drift */
  noDrift: number;
  /** Tenants with drift */
  withDrift: number;
  /** Tenants with errors */
  error: number;
  /** Detailed results per tenant */
  details: TenantSchemaDrift[];
  /** Timestamp of the check */
  timestamp: string;
  /** Duration of the check in ms */
  durationMs: number;
}

/**
 * Options for schema drift detection
 */
export interface SchemaDriftOptions {
  /** Tenant ID to use as reference (default: first tenant) */
  referenceTenant?: string;
  /** Specific tenant IDs to check (default: all tenants) */
  tenantIds?: string[];
  /** Number of concurrent checks */
  concurrency?: number;
  /** Whether to include index comparison */
  includeIndexes?: boolean;
  /** Whether to include constraint comparison */
  includeConstraints?: boolean;
  /** Tables to exclude from comparison */
  excludeTables?: string[];
  /** Progress callback */
  onProgress?: (tenantId: string, status: 'starting' | 'introspecting' | 'comparing' | 'completed' | 'failed') => void;
}

// ============================================================================
// Clone Types (re-exported from clone module)
// ============================================================================

export type {
  CloneTenantOptions,
  CloneTenantResult,
  CloneProgressCallback,
  CloneProgressStatus,
  AnonymizeOptions,
  AnonymizeRules,
  AnonymizeValue,
} from './clone/types.js';

// ============================================================================
// Shared Schema Migration Types
// ============================================================================

/**
 * Migration status for the shared schema (public)
 */
export interface SharedMigrationStatus {
  /** Schema name (usually 'public') */
  schemaName: string;
  /** Number of applied migrations */
  appliedCount: number;
  /** Number of pending migrations */
  pendingCount: number;
  /** Names of pending migrations */
  pendingMigrations: string[];
  /** Overall status */
  status: 'ok' | 'behind' | 'error';
  /** Error message if status is 'error' */
  error?: string;
  /** Detected table format */
  format: TableFormat | null;
}

/**
 * Migration result for the shared schema
 */
export interface SharedMigrationResult {
  /** Schema name (usually 'public') */
  schemaName: string;
  /** Whether migration was successful */
  success: boolean;
  /** List of applied migration names */
  appliedMigrations: string[];
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Table format used */
  format?: TableFormat;
}

/**
 * Shared migration configuration (extends MigratorConfig)
 */
export interface SharedMigratorConfig {
  /** Path to shared schema migrations folder */
  sharedMigrationsFolder: string;
  /** Table name for tracking shared migrations (default: '__drizzle_shared_migrations') */
  sharedMigrationsTable?: string;
  /** Migration hooks for shared schema */
  hooks?: SharedMigrationHooks;
  /**
   * Table format for tracking migrations
   * @default "auto"
   */
  tableFormat?: 'auto' | TableFormat;
  /**
   * Default format when creating new table
   * @default "name"
   */
  defaultFormat?: TableFormat;
}

/**
 * Hooks for shared schema migrations
 */
export interface SharedMigrationHooks {
  /** Called before starting shared migration */
  beforeMigration?: () => void | Promise<void>;
  /** Called after shared migration completes */
  afterMigration?: (result: SharedMigrationResult) => void | Promise<void>;
  /** Called before applying a specific migration */
  beforeApply?: (migrationName: string) => void | Promise<void>;
  /** Called after applying a specific migration */
  afterApply?: (migrationName: string, durationMs: number) => void | Promise<void>;
}

/**
 * Options for shared migration operations
 */
export interface SharedMigrateOptions {
  /** Dry run mode - show what would be applied without executing */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (status: 'starting' | 'migrating' | 'completed' | 'failed', migrationName?: string) => void;
}

/**
 * Seed function signature for shared schema
 * Called with the shared database instance
 */
export type SharedSeedFunction<TSchema extends Record<string, unknown> = Record<string, unknown>> = (
  db: PostgresJsDatabase<TSchema>
) => Promise<void>;

/**
 * Result of shared schema seeding
 */
export interface SharedSeedResult {
  /** Schema name (usually 'public') */
  schemaName: string;
  /** Whether seeding was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}
