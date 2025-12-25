/**
 * Constraint Analyzer
 *
 * Analyzes and compares constraint structures between schemas.
 * Detects missing constraints, extra constraints, and definition mismatches.
 *
 * @module drift/constraint-analyzer
 */

import type { Pool } from 'pg';
import type { ConstraintInfo, ConstraintDrift } from './types.js';

/**
 * Introspects constraints for a specific table in a schema.
 *
 * Retrieves detailed constraint metadata including type, columns,
 * foreign key references, and check expressions.
 *
 * @param pool - Database connection pool
 * @param schemaName - PostgreSQL schema name
 * @param tableName - Table name to introspect
 * @returns Array of constraint information
 *
 * @example
 * ```typescript
 * const constraints = await introspectConstraints(pool, 'tenant_123', 'orders');
 * for (const con of constraints) {
 *   console.log(`${con.name}: ${con.type} on (${con.columns.join(', ')})`);
 * }
 * ```
 */
export async function introspectConstraints(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<ConstraintInfo[]> {
  const result = await pool.query<{
    constraint_name: string;
    constraint_type: string;
    column_name: string;
    foreign_table_schema: string | null;
    foreign_table_name: string | null;
    foreign_column_name: string | null;
    check_clause: string | null;
  }>(
    `SELECT
      tc.constraint_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_schema as foreign_table_schema,
      ccu.table_name as foreign_table_name,
      ccu.column_name as foreign_column_name,
      cc.check_clause
     FROM information_schema.table_constraints tc
     LEFT JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     LEFT JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
       AND tc.constraint_type = 'FOREIGN KEY'
     LEFT JOIN information_schema.check_constraints cc
       ON tc.constraint_name = cc.constraint_name
       AND tc.constraint_type = 'CHECK'
     WHERE tc.table_schema = $1 AND tc.table_name = $2
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [schemaName, tableName]
  );

  // Group by constraint name since multi-column constraints return multiple rows
  const constraintMap = new Map<string, ConstraintInfo>();

  for (const row of result.rows) {
    const existing = constraintMap.get(row.constraint_name);
    if (existing) {
      // Add column if not already present
      if (row.column_name && !existing.columns.includes(row.column_name)) {
        existing.columns.push(row.column_name);
      }
      // Add foreign column if not already present
      if (
        row.foreign_column_name &&
        existing.foreignColumns &&
        !existing.foreignColumns.includes(row.foreign_column_name)
      ) {
        existing.foreignColumns.push(row.foreign_column_name);
      }
    } else {
      const constraint: ConstraintInfo = {
        name: row.constraint_name,
        type: row.constraint_type as ConstraintInfo['type'],
        columns: row.column_name ? [row.column_name] : [],
      };
      if (row.foreign_table_name) {
        constraint.foreignTable = row.foreign_table_name;
      }
      if (row.foreign_column_name) {
        constraint.foreignColumns = [row.foreign_column_name];
      }
      if (row.check_clause) {
        constraint.checkExpression = row.check_clause;
      }
      constraintMap.set(row.constraint_name, constraint);
    }
  }

  return Array.from(constraintMap.values());
}

/**
 * Compares constraints between a reference and target schema.
 *
 * Detects the following types of drift:
 * - Missing constraints: Present in reference but absent in target
 * - Extra constraints: Present in target but absent in reference
 * - Definition mismatches: Different type or columns
 *
 * @param reference - Constraints from the reference (expected) schema
 * @param target - Constraints from the target (actual) schema
 * @returns Array of constraint drift details
 *
 * @example
 * ```typescript
 * const refConstraints = await introspectConstraints(pool, 'tenant_ref', 'orders');
 * const targetConstraints = await introspectConstraints(pool, 'tenant_123', 'orders');
 * const drifts = compareConstraints(refConstraints, targetConstraints);
 *
 * for (const drift of drifts) {
 *   console.log(`${drift.constraint}: ${drift.description}`);
 * }
 * ```
 */
export function compareConstraints(
  reference: ConstraintInfo[],
  target: ConstraintInfo[]
): ConstraintDrift[] {
  const drifts: ConstraintDrift[] = [];
  const refConstraintMap = new Map(reference.map((c) => [c.name, c]));
  const targetConstraintMap = new Map(target.map((c) => [c.name, c]));

  // Check for missing constraints
  for (const refConstraint of reference) {
    const targetConstraint = targetConstraintMap.get(refConstraint.name);

    if (!targetConstraint) {
      drifts.push({
        constraint: refConstraint.name,
        type: 'missing',
        expected: `${refConstraint.type} on (${refConstraint.columns.join(', ')})`,
        description: `Constraint "${refConstraint.name}" (${refConstraint.type}) is missing`,
      });
      continue;
    }

    // Compare constraint details
    const refCols = refConstraint.columns.sort().join(',');
    const targetCols = targetConstraint.columns.sort().join(',');
    if (refConstraint.type !== targetConstraint.type || refCols !== targetCols) {
      drifts.push({
        constraint: refConstraint.name,
        type: 'definition_mismatch',
        expected: `${refConstraint.type} on (${refConstraint.columns.join(', ')})`,
        actual: `${targetConstraint.type} on (${targetConstraint.columns.join(', ')})`,
        description: `Constraint "${refConstraint.name}" definition differs`,
      });
    }
  }

  // Check for extra constraints
  for (const targetConstraint of target) {
    if (!refConstraintMap.has(targetConstraint.name)) {
      drifts.push({
        constraint: targetConstraint.name,
        type: 'extra',
        actual: `${targetConstraint.type} on (${targetConstraint.columns.join(', ')})`,
        description: `Extra constraint "${targetConstraint.name}" (${targetConstraint.type}) not in reference`,
      });
    }
  }

  return drifts;
}
