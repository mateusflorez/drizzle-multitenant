/**
 * Types for tenant cloning module
 * @module clone/types
 */

import type { Pool } from 'pg';

/**
 * Value to use for anonymization (v1: null or fixed value)
 */
export type AnonymizeValue = null | string | number | boolean;

/**
 * Anonymization rules by table and column
 *
 * @example
 * ```typescript
 * const rules: AnonymizeRules = {
 *   users: {
 *     email: null,
 *     phone: null,
 *     ssn: '000-00-0000',
 *   },
 *   payments: {
 *     card_number: null,
 *   },
 * };
 * ```
 */
export interface AnonymizeRules {
  [tableName: string]: {
    [columnName: string]: AnonymizeValue;
  };
}

/**
 * Anonymization options
 */
export interface AnonymizeOptions {
  /** Enable anonymization */
  enabled: boolean;
  /** Rules per table/column */
  rules?: AnonymizeRules;
}

/**
 * Options for cloning a tenant
 */
export interface CloneTenantOptions {
  /** Include data (default: false, schema only) */
  includeData?: boolean;
  /** Anonymize sensitive data */
  anonymize?: AnonymizeOptions;
  /** Tables to exclude from cloning */
  excludeTables?: string[];
  /** Progress callback */
  onProgress?: CloneProgressCallback;
  /** Error handler */
  onError?: (error: Error) => 'continue' | 'abort';
}

/**
 * Progress status for cloning operation
 */
export type CloneProgressStatus =
  | 'starting'
  | 'introspecting'
  | 'creating_schema'
  | 'creating_tables'
  | 'creating_indexes'
  | 'creating_constraints'
  | 'copying_data'
  | 'completed'
  | 'failed';

/**
 * Progress callback for cloning
 */
export type CloneProgressCallback = (
  status: CloneProgressStatus,
  details?: { table?: string; progress?: number; total?: number }
) => void;

/**
 * Result of cloning a tenant
 */
export interface CloneTenantResult {
  /** Source tenant ID */
  sourceTenant: string;
  /** Target tenant ID */
  targetTenant: string;
  /** Target schema name */
  targetSchema: string;
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Tables cloned */
  tables: string[];
  /** Number of rows copied (if includeData) */
  rowsCopied?: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Configuration for Cloner
 */
export interface ClonerConfig {
  /** Migrations table name (excluded from data copy) */
  migrationsTable?: string;
}

/**
 * Dependencies for Cloner
 */
export interface ClonerDependencies {
  /** Create pool for specific schema */
  createPool: (schemaName: string) => Promise<Pool>;
  /** Create pool without schema (root) */
  createRootPool: () => Promise<Pool>;
  /** Schema name template function */
  schemaNameTemplate: (tenantId: string) => string;
  /** Check if schema exists */
  schemaExists: (tenantId: string) => Promise<boolean>;
  /** Create schema */
  createSchema: (tenantId: string) => Promise<void>;
}

/**
 * Table clone information
 */
export interface TableCloneInfo {
  /** Table name */
  name: string;
  /** CREATE TABLE DDL */
  createDdl: string;
  /** Index DDLs (separate for correct order) */
  indexDdls: string[];
  /** Constraint DDLs (separate for correct order) */
  constraintDdls: string[];
  /** Row count */
  rowCount: number;
}

/**
 * Column information from introspection
 */
export interface ColumnInfo {
  columnName: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  columnDefault: string | null;
  characterMaximumLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
}
