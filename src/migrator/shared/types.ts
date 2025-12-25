import type { Pool } from 'pg';
import type { MigrationFile } from '../types.js';
import type { DetectedFormat } from '../table-format.js';

/**
 * Configuration for SharedMigrationExecutor
 */
export interface SharedMigrationExecutorConfig {
  /** Schema name for shared tables (default: 'public') */
  schemaName?: string;
  /** Table name for tracking migrations */
  migrationsTable: string;
  /** Hooks for migration events */
  hooks?: {
    beforeMigration?: () => void | Promise<void>;
    afterMigration?: (migrationName: string, durationMs: number) => void | Promise<void>;
  };
}

/**
 * Dependencies for SharedMigrationExecutor
 */
export interface SharedMigrationExecutorDependencies {
  /** Create a database pool for the shared schema */
  createPool: () => Promise<Pool>;
  /** Check if migrations table exists */
  migrationsTableExists: (pool: Pool, schemaName: string) => Promise<boolean>;
  /** Ensure migrations table exists with correct format */
  ensureMigrationsTable: (pool: Pool, schemaName: string, format: DetectedFormat) => Promise<void>;
  /** Get or detect migration table format */
  getOrDetectFormat: (pool: Pool, schemaName: string) => Promise<DetectedFormat>;
  /** Load migrations from disk */
  loadMigrations: () => Promise<MigrationFile[]>;
}

/**
 * Applied migration record from database
 */
export interface AppliedMigration {
  /** Migration identifier (name or hash) */
  identifier: string;
  /** Migration name (for name-based format) */
  name?: string;
  /** Migration hash (for hash-based format) */
  hash?: string;
  /** When migration was applied */
  appliedAt: Date;
}

/**
 * Raw database record for applied migration
 */
export interface AppliedMigrationRecord {
  id: number;
  identifier: string;
  applied_at: Date | string | number;
}
