/**
 * Column Analyzer
 *
 * Analyzes and compares column structures between schemas.
 * Detects missing columns, extra columns, type mismatches, nullable changes, and default value changes.
 *
 * @module drift/column-analyzer
 */

import type { Pool } from 'pg';
import type { ColumnInfo, ColumnDrift } from './types.js';

/**
 * Introspects columns for a specific table in a schema.
 *
 * Retrieves detailed column metadata including data types, nullability,
 * defaults, and precision information.
 *
 * @param pool - Database connection pool
 * @param schemaName - PostgreSQL schema name
 * @param tableName - Table name to introspect
 * @returns Array of column information
 *
 * @example
 * ```typescript
 * const columns = await introspectColumns(pool, 'tenant_123', 'users');
 * for (const col of columns) {
 *   console.log(`${col.name}: ${col.dataType} ${col.isNullable ? 'NULL' : 'NOT NULL'}`);
 * }
 * ```
 */
export async function introspectColumns(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<ColumnInfo[]> {
  const result = await pool.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    ordinal_position: number;
  }>(
    `SELECT
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      ordinal_position
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schemaName, tableName]
  );

  return result.rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    udtName: row.udt_name,
    isNullable: row.is_nullable === 'YES',
    columnDefault: row.column_default,
    characterMaximumLength: row.character_maximum_length,
    numericPrecision: row.numeric_precision,
    numericScale: row.numeric_scale,
    ordinalPosition: row.ordinal_position,
  }));
}

/**
 * Normalizes a default value for comparison.
 *
 * Removes type casts and schema qualifiers to enable accurate comparison
 * between schemas that may have different representations of the same default.
 *
 * @param value - The default value expression from the database
 * @returns Normalized value string or null
 *
 * @example
 * ```typescript
 * normalizeDefault("'123'::integer")  // Returns: '123'
 * normalizeDefault("CURRENT_TIMESTAMP")  // Returns: 'CURRENT_TIMESTAMP'
 * normalizeDefault(null)  // Returns: null
 * ```
 */
export function normalizeDefault(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(/^'(.+)'::.+$/, '$1') // '123'::integer -> 123
    .replace(/^(.+)::.+$/, '$1') // value::type -> value
    .trim();
}

/**
 * Compares columns between a reference and target schema.
 *
 * Detects the following types of drift:
 * - Missing columns: Present in reference but absent in target
 * - Extra columns: Present in target but absent in reference
 * - Type mismatches: Different data types
 * - Nullable mismatches: Different NULL/NOT NULL constraints
 * - Default mismatches: Different default values
 *
 * @param reference - Columns from the reference (expected) schema
 * @param target - Columns from the target (actual) schema
 * @returns Array of column drift details
 *
 * @example
 * ```typescript
 * const refColumns = await introspectColumns(pool, 'tenant_ref', 'users');
 * const targetColumns = await introspectColumns(pool, 'tenant_123', 'users');
 * const drifts = compareColumns(refColumns, targetColumns);
 *
 * for (const drift of drifts) {
 *   console.log(`${drift.column}: ${drift.description}`);
 * }
 * ```
 */
export function compareColumns(
  reference: ColumnInfo[],
  target: ColumnInfo[]
): ColumnDrift[] {
  const drifts: ColumnDrift[] = [];
  const refColMap = new Map(reference.map((c) => [c.name, c]));
  const targetColMap = new Map(target.map((c) => [c.name, c]));

  // Check for missing and drifted columns
  for (const refCol of reference) {
    const targetCol = targetColMap.get(refCol.name);

    if (!targetCol) {
      drifts.push({
        column: refCol.name,
        type: 'missing',
        expected: refCol.dataType,
        description: `Column "${refCol.name}" (${refCol.dataType}) is missing`,
      });
      continue;
    }

    // Compare data types (normalize by comparing udt_name)
    if (refCol.udtName !== targetCol.udtName) {
      drifts.push({
        column: refCol.name,
        type: 'type_mismatch',
        expected: refCol.udtName,
        actual: targetCol.udtName,
        description: `Column "${refCol.name}" type mismatch: expected "${refCol.udtName}", got "${targetCol.udtName}"`,
      });
    }

    // Compare nullable
    if (refCol.isNullable !== targetCol.isNullable) {
      drifts.push({
        column: refCol.name,
        type: 'nullable_mismatch',
        expected: refCol.isNullable,
        actual: targetCol.isNullable,
        description: `Column "${refCol.name}" nullable mismatch: expected ${refCol.isNullable ? 'NULL' : 'NOT NULL'}, got ${targetCol.isNullable ? 'NULL' : 'NOT NULL'}`,
      });
    }

    // Compare defaults (normalize by removing schema qualifiers)
    const normalizedRefDefault = normalizeDefault(refCol.columnDefault);
    const normalizedTargetDefault = normalizeDefault(targetCol.columnDefault);
    if (normalizedRefDefault !== normalizedTargetDefault) {
      drifts.push({
        column: refCol.name,
        type: 'default_mismatch',
        expected: refCol.columnDefault,
        actual: targetCol.columnDefault,
        description: `Column "${refCol.name}" default mismatch: expected "${refCol.columnDefault ?? 'none'}", got "${targetCol.columnDefault ?? 'none'}"`,
      });
    }
  }

  // Check for extra columns
  for (const targetCol of target) {
    if (!refColMap.has(targetCol.name)) {
      drifts.push({
        column: targetCol.name,
        type: 'extra',
        actual: targetCol.dataType,
        description: `Extra column "${targetCol.name}" (${targetCol.dataType}) not in reference`,
      });
    }
  }

  return drifts;
}
