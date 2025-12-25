/**
 * Internal types for the SyncManager module
 *
 * Public types are re-exported from the main types.ts file
 * @module sync/types
 */

import type { Pool } from 'pg';
import type { SyncOptions as PublicSyncOptions, MigrationFile } from '../types.js';
import type { DetectedFormat } from '../table-format.js';

/**
 * Extended sync options with internal properties
 */
export interface InternalSyncOptions extends PublicSyncOptions {
  /** Pre-loaded migrations (avoids reloading from disk) */
  migrations?: MigrationFile[];
}

/**
 * Configuration for the SyncManager
 */
export interface SyncManagerConfig {
  /** Function to discover tenant IDs */
  tenantDiscovery: () => Promise<string[]>;
  /** Path to migrations folder */
  migrationsFolder: string;
  /** Migrations table name */
  migrationsTable: string;
}

/**
 * SyncManager dependencies
 */
export interface SyncManagerDependencies {
  /** Create a pool for a specific schema */
  createPool: (schemaName: string) => Promise<Pool>;
  /** Schema name template function */
  schemaNameTemplate: (tenantId: string) => string;
  /** Check if migrations table exists */
  migrationsTableExists: (pool: Pool, schemaName: string) => Promise<boolean>;
  /** Ensure migrations table exists */
  ensureMigrationsTable: (pool: Pool, schemaName: string, format: DetectedFormat) => Promise<void>;
  /** Get or detect the format for a schema */
  getOrDetectFormat: (pool: Pool, schemaName: string) => Promise<DetectedFormat>;
  /** Load migrations from disk */
  loadMigrations: () => Promise<MigrationFile[]>;
}

/**
 * Applied migration record (internal format)
 */
export interface AppliedMigrationRecord {
  id: number;
  identifier: string;
  applied_at: string | number;
}
