/**
 * Schema Drift Detection Types
 *
 * Re-exports types from the main types module for convenience.
 * These types are used for introspecting and comparing schemas.
 *
 * @module drift/types
 */

export type {
  // Introspection types
  ColumnInfo,
  IndexInfo,
  ConstraintInfo,
  TableSchema,
  TenantSchema,
  // Drift result types
  ColumnDrift,
  IndexDrift,
  ConstraintDrift,
  TableDrift,
  TenantSchemaDrift,
  SchemaDriftStatus,
  // Options
  SchemaDriftOptions,
} from '../types.js';

export type { IntrospectOptions } from '../interfaces.js';
