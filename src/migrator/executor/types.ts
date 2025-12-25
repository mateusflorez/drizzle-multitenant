import type { Pool } from 'pg';
import type { MigrationFile, MigrationHooks, MigrationProgressCallback, MigrationErrorHandler } from '../types.js';
import type { DetectedFormat } from '../table-format.js';

/**
 * Applied migration record from database query
 */
export interface AppliedMigrationRecord {
  id: number;
  identifier: string;
  applied_at: string | number;
}

/**
 * Applied migration with parsed data
 */
export interface AppliedMigration {
  identifier: string;
  name?: string;
  hash?: string;
  appliedAt: Date;
}

/**
 * Configuration for MigrationExecutor
 */
export interface MigrationExecutorConfig {
  /** Migration hooks for lifecycle events */
  hooks?: MigrationHooks | undefined;
}

/**
 * Dependencies for MigrationExecutor
 */
export interface MigrationExecutorDependencies {
  /** Create a database pool for a schema */
  createPool: (schemaName: string) => Promise<Pool>;
  /** Get schema name from tenant ID */
  schemaNameTemplate: (tenantId: string) => string;
  /** Check if migrations table exists */
  migrationsTableExists: (pool: Pool, schemaName: string) => Promise<boolean>;
  /** Ensure migrations table exists with correct format */
  ensureMigrationsTable: (pool: Pool, schemaName: string, format: DetectedFormat) => Promise<void>;
  /** Get or detect table format */
  getOrDetectFormat: (pool: Pool, schemaName: string) => Promise<DetectedFormat>;
  /** Load migrations from disk */
  loadMigrations: () => Promise<MigrationFile[]>;
}

/**
 * Options for migrating a single tenant
 */
export interface MigrateTenantOptions {
  /** Whether to skip actual SQL execution (dry run) */
  dryRun?: boolean | undefined;
  /** Progress callback */
  onProgress?: MigrationProgressCallback | undefined;
}

/**
 * Configuration for BatchExecutor
 */
export interface BatchExecutorConfig {
  /** Function to discover tenant IDs */
  tenantDiscovery: () => Promise<string[]>;
}

/**
 * Options for batch migration operations
 */
export interface BatchMigrateOptions {
  /** Number of concurrent migrations */
  concurrency?: number;
  /** Progress callback */
  onProgress?: MigrationProgressCallback;
  /** Error handler */
  onError?: MigrationErrorHandler;
  /** Dry run mode */
  dryRun?: boolean;
}
