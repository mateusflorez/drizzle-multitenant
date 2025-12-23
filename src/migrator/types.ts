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
  name: string;
  appliedAt: Date;
}
