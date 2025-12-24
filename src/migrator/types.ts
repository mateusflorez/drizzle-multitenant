import type { TableFormat } from './table-format.js';

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
