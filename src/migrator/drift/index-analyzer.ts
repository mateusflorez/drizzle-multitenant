/**
 * Index Analyzer
 *
 * Analyzes and compares index structures between schemas.
 * Detects missing indexes, extra indexes, and definition mismatches.
 *
 * @module drift/index-analyzer
 */

import type { Pool } from 'pg';
import type { IndexInfo, IndexDrift } from './types.js';

/**
 * Introspects indexes for a specific table in a schema.
 *
 * Retrieves detailed index metadata including columns, uniqueness,
 * and full index definition.
 *
 * @param pool - Database connection pool
 * @param schemaName - PostgreSQL schema name
 * @param tableName - Table name to introspect
 * @returns Array of index information
 *
 * @example
 * ```typescript
 * const indexes = await introspectIndexes(pool, 'tenant_123', 'users');
 * for (const idx of indexes) {
 *   console.log(`${idx.name}: ${idx.columns.join(', ')} ${idx.isUnique ? 'UNIQUE' : ''}`);
 * }
 * ```
 */
export async function introspectIndexes(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<IndexInfo[]> {
  // Get index definitions
  const indexResult = await pool.query<{
    indexname: string;
    indexdef: string;
  }>(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = $1 AND tablename = $2
     ORDER BY indexname`,
    [schemaName, tableName]
  );

  // Get index columns and properties from pg_index
  const indexDetails = await pool.query<{
    indexname: string;
    column_name: string;
    is_unique: boolean;
    is_primary: boolean;
  }>(
    `SELECT
      i.relname as indexname,
      a.attname as column_name,
      ix.indisunique as is_unique,
      ix.indisprimary as is_primary
     FROM pg_class t
     JOIN pg_index ix ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = $2
     ORDER BY i.relname, a.attnum`,
    [schemaName, tableName]
  );

  // Group columns by index
  const indexColumnsMap = new Map<
    string,
    { columns: string[]; isUnique: boolean; isPrimary: boolean }
  >();

  for (const row of indexDetails.rows) {
    const existing = indexColumnsMap.get(row.indexname);
    if (existing) {
      existing.columns.push(row.column_name);
    } else {
      indexColumnsMap.set(row.indexname, {
        columns: [row.column_name],
        isUnique: row.is_unique,
        isPrimary: row.is_primary,
      });
    }
  }

  return indexResult.rows.map((row) => {
    const details = indexColumnsMap.get(row.indexname);
    return {
      name: row.indexname,
      columns: details?.columns ?? [],
      isUnique: details?.isUnique ?? false,
      isPrimary: details?.isPrimary ?? false,
      definition: row.indexdef,
    };
  });
}

/**
 * Compares indexes between a reference and target schema.
 *
 * Detects the following types of drift:
 * - Missing indexes: Present in reference but absent in target
 * - Extra indexes: Present in target but absent in reference
 * - Definition mismatches: Different columns or uniqueness settings
 *
 * @param reference - Indexes from the reference (expected) schema
 * @param target - Indexes from the target (actual) schema
 * @returns Array of index drift details
 *
 * @example
 * ```typescript
 * const refIndexes = await introspectIndexes(pool, 'tenant_ref', 'users');
 * const targetIndexes = await introspectIndexes(pool, 'tenant_123', 'users');
 * const drifts = compareIndexes(refIndexes, targetIndexes);
 *
 * for (const drift of drifts) {
 *   console.log(`${drift.index}: ${drift.description}`);
 * }
 * ```
 */
export function compareIndexes(
  reference: IndexInfo[],
  target: IndexInfo[]
): IndexDrift[] {
  const drifts: IndexDrift[] = [];
  const refIndexMap = new Map(reference.map((i) => [i.name, i]));
  const targetIndexMap = new Map(target.map((i) => [i.name, i]));

  // Check for missing indexes
  for (const refIndex of reference) {
    const targetIndex = targetIndexMap.get(refIndex.name);

    if (!targetIndex) {
      drifts.push({
        index: refIndex.name,
        type: 'missing',
        expected: refIndex.definition,
        description: `Index "${refIndex.name}" is missing`,
      });
      continue;
    }

    // Compare columns and uniqueness
    const refCols = refIndex.columns.sort().join(',');
    const targetCols = targetIndex.columns.sort().join(',');
    if (refCols !== targetCols || refIndex.isUnique !== targetIndex.isUnique) {
      drifts.push({
        index: refIndex.name,
        type: 'definition_mismatch',
        expected: refIndex.definition,
        actual: targetIndex.definition,
        description: `Index "${refIndex.name}" definition differs`,
      });
    }
  }

  // Check for extra indexes
  for (const targetIndex of target) {
    if (!refIndexMap.has(targetIndex.name)) {
      drifts.push({
        index: targetIndex.name,
        type: 'extra',
        actual: targetIndex.definition,
        description: `Extra index "${targetIndex.name}" not in reference`,
      });
    }
  }

  return drifts;
}
