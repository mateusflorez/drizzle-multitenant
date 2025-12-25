/**
 * Data Copier
 *
 * Copies data between schemas using INSERT...SELECT.
 * Supports anonymization of sensitive columns.
 *
 * @module clone/data-copier
 */

import type { Pool } from 'pg';
import type { AnonymizeRules, CloneProgressCallback } from './types.js';

/**
 * Get column names for a table
 */
export async function getTableColumns(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<string[]> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schemaName, tableName]
  );
  return result.rows.map((r) => r.column_name);
}

/**
 * Format anonymize value for SQL
 */
function formatAnonymizeValue(value: null | string | number | boolean): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    // Escape single quotes
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  return String(value);
}

/**
 * Copy data from one table to another
 *
 * @returns Number of rows copied
 */
export async function copyTableData(
  pool: Pool,
  sourceSchema: string,
  targetSchema: string,
  tableName: string,
  anonymizeRules?: AnonymizeRules
): Promise<number> {
  const columns = await getTableColumns(pool, sourceSchema, tableName);

  if (columns.length === 0) {
    return 0;
  }

  // Build SELECT with anonymization
  const tableRules = anonymizeRules?.[tableName] ?? {};
  const selectColumns = columns.map((col) => {
    if (col in tableRules) {
      const value = tableRules[col];
      return `${formatAnonymizeValue(value)} as "${col}"`;
    }
    return `"${col}"`;
  });

  const insertColumns = columns.map((c) => `"${c}"`).join(', ');
  const selectExpr = selectColumns.join(', ');

  const result = await pool.query(
    `INSERT INTO "${targetSchema}"."${tableName}" (${insertColumns})
     SELECT ${selectExpr}
     FROM "${sourceSchema}"."${tableName}"`
  );

  return result.rowCount ?? 0;
}

/**
 * Get tables in dependency order for data copy
 *
 * Tables with foreign keys should be copied after their referenced tables.
 * This uses a topological sort based on foreign key relationships.
 */
export async function getTablesInDependencyOrder(
  pool: Pool,
  schemaName: string,
  tables: string[]
): Promise<string[]> {
  // Get all foreign key relationships
  const result = await pool.query<{
    table_name: string;
    foreign_table_name: string;
  }>(
    `SELECT DISTINCT
      tc.table_name,
      ccu.table_name as foreign_table_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
     WHERE tc.table_schema = $1
       AND tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_name != ccu.table_name`,
    [schemaName]
  );

  // Build dependency graph
  const dependencies = new Map<string, Set<string>>();
  const tableSet = new Set(tables);

  for (const table of tables) {
    dependencies.set(table, new Set());
  }

  for (const row of result.rows) {
    if (tableSet.has(row.table_name) && tableSet.has(row.foreign_table_name)) {
      dependencies.get(row.table_name)!.add(row.foreign_table_name);
    }
  }

  // Topological sort (Kahn's algorithm)
  const sorted: string[] = [];
  const inDegree = new Map<string, number>();
  const queue: string[] = [];

  // Calculate in-degrees
  for (const table of tables) {
    inDegree.set(table, 0);
  }
  for (const [table, deps] of dependencies) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  // Find nodes with no incoming edges
  for (const [table, degree] of inDegree) {
    if (degree === 0) {
      queue.push(table);
    }
  }

  // Process queue
  while (queue.length > 0) {
    const table = queue.shift()!;
    sorted.push(table);

    // Remove edges from this node
    for (const [otherTable, deps] of dependencies) {
      if (deps.has(table)) {
        deps.delete(table);
        const newDegree = (inDegree.get(otherTable) ?? 0) - 1;
        inDegree.set(otherTable, newDegree);
        if (newDegree === 0) {
          queue.push(otherTable);
        }
      }
    }
  }

  // If there's a cycle, just use original order for remaining tables
  const remaining = tables.filter((t) => !sorted.includes(t));
  return [...sorted, ...remaining];
}

/**
 * Copy data from all tables
 *
 * @returns Total number of rows copied
 */
export async function copyAllData(
  pool: Pool,
  sourceSchema: string,
  targetSchema: string,
  tables: string[],
  anonymizeRules?: AnonymizeRules,
  onProgress?: CloneProgressCallback
): Promise<number> {
  let totalRows = 0;

  // Get tables in dependency order
  const orderedTables = await getTablesInDependencyOrder(pool, sourceSchema, tables);

  // Disable triggers temporarily for faster insert and to avoid constraint issues
  await pool.query('SET session_replication_role = replica');

  try {
    for (let i = 0; i < orderedTables.length; i++) {
      const table = orderedTables[i]!;

      onProgress?.('copying_data', {
        table,
        progress: i + 1,
        total: orderedTables.length,
      });

      const rows = await copyTableData(pool, sourceSchema, targetSchema, table, anonymizeRules);

      totalRows += rows;
    }
  } finally {
    // Re-enable triggers
    await pool.query('SET session_replication_role = DEFAULT');
  }

  return totalRows;
}
