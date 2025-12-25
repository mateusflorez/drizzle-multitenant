/**
 * DDL Generator
 *
 * Generates DDL (CREATE TABLE, indexes, constraints) from introspection.
 * Uses information_schema and pg_catalog to reconstruct structure.
 *
 * @module clone/ddl-generator
 */

import type { Pool } from 'pg';
import type { TableCloneInfo, ColumnInfo } from './types.js';

/**
 * List all tables in a schema
 */
export async function listTables(
  pool: Pool,
  schemaName: string,
  excludeTables: string[] = []
): Promise<string[]> {
  // Build placeholders for excluded tables
  const excludePlaceholders =
    excludeTables.length > 0
      ? excludeTables.map((_, i) => `$${i + 2}`).join(', ')
      : "''::text";

  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
       AND table_name NOT IN (${excludePlaceholders})
     ORDER BY table_name`,
    [schemaName, ...excludeTables]
  );
  return result.rows.map((r) => r.table_name);
}

/**
 * Get column information for a table
 */
export async function getColumns(
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
  }>(
    `SELECT
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default,
      character_maximum_length,
      numeric_precision,
      numeric_scale
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schemaName, tableName]
  );

  return result.rows.map((row) => ({
    columnName: row.column_name,
    dataType: row.data_type,
    udtName: row.udt_name,
    isNullable: row.is_nullable === 'YES',
    columnDefault: row.column_default,
    characterMaximumLength: row.character_maximum_length,
    numericPrecision: row.numeric_precision,
    numericScale: row.numeric_scale,
  }));
}

/**
 * Generate CREATE TABLE DDL for a table
 */
export async function generateTableDdl(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<string> {
  const columns = await getColumns(pool, schemaName, tableName);

  const columnDefs = columns.map((col) => {
    let type = col.udtName;

    // Handle special types
    if (col.dataType === 'character varying' && col.characterMaximumLength) {
      type = `varchar(${col.characterMaximumLength})`;
    } else if (col.dataType === 'character' && col.characterMaximumLength) {
      type = `char(${col.characterMaximumLength})`;
    } else if (col.dataType === 'numeric' && col.numericPrecision) {
      type = `numeric(${col.numericPrecision}${col.numericScale ? `, ${col.numericScale}` : ''})`;
    } else if (col.dataType === 'ARRAY') {
      // Array types are stored as _typename in udt_name
      type = col.udtName.replace(/^_/, '') + '[]';
    }

    // Build column definition
    let definition = `"${col.columnName}" ${type}`;

    if (!col.isNullable) {
      definition += ' NOT NULL';
    }

    if (col.columnDefault) {
      // Replace old schema reference in default values
      const defaultValue = col.columnDefault.replace(
        new RegExp(`"?${schemaName}"?\\.`, 'g'),
        ''
      );
      definition += ` DEFAULT ${defaultValue}`;
    }

    return definition;
  });

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${columnDefs.join(',\n  ')}\n)`;
}

/**
 * Generate index DDLs for a table
 */
export async function generateIndexDdls(
  pool: Pool,
  sourceSchema: string,
  targetSchema: string,
  tableName: string
): Promise<string[]> {
  const result = await pool.query<{ indexdef: string; indexname: string }>(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = $1 AND tablename = $2
       AND indexname NOT LIKE '%_pkey'`,
    [sourceSchema, tableName]
  );

  return result.rows.map((row) =>
    // Replace source schema with target schema
    row.indexdef
      .replace(new RegExp(`ON "${sourceSchema}"\\."`, 'g'), `ON "${targetSchema}"."`)
      .replace(new RegExp(`"${sourceSchema}"\\."`, 'g'), `"${targetSchema}"."`),
  );
}

/**
 * Generate primary key DDL for a table
 */
export async function generatePrimaryKeyDdl(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<string | null> {
  const result = await pool.query<{
    constraint_name: string;
    column_name: string;
  }>(
    `SELECT
      tc.constraint_name,
      kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [schemaName, tableName]
  );

  if (result.rows.length === 0) return null;

  const columns = result.rows.map((r) => `"${r.column_name}"`).join(', ');
  const constraintName = result.rows[0]!.constraint_name;

  return `ALTER TABLE "${tableName}" ADD CONSTRAINT "${constraintName}" PRIMARY KEY (${columns})`;
}

/**
 * Generate foreign key DDLs for a table
 */
export async function generateForeignKeyDdls(
  pool: Pool,
  sourceSchema: string,
  targetSchema: string,
  tableName: string
): Promise<string[]> {
  const result = await pool.query<{
    constraint_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    update_rule: string;
    delete_rule: string;
  }>(
    `SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name as foreign_table_name,
      ccu.column_name as foreign_column_name,
      rc.update_rule,
      rc.delete_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
     JOIN information_schema.referential_constraints rc
       ON tc.constraint_name = rc.constraint_name
       AND tc.table_schema = rc.constraint_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [sourceSchema, tableName]
  );

  // Group by constraint name
  const fkMap = new Map<
    string,
    {
      columns: string[];
      foreignTable: string;
      foreignColumns: string[];
      updateRule: string;
      deleteRule: string;
    }
  >();

  for (const row of result.rows) {
    const existing = fkMap.get(row.constraint_name);
    if (existing) {
      existing.columns.push(row.column_name);
      existing.foreignColumns.push(row.foreign_column_name);
    } else {
      fkMap.set(row.constraint_name, {
        columns: [row.column_name],
        foreignTable: row.foreign_table_name,
        foreignColumns: [row.foreign_column_name],
        updateRule: row.update_rule,
        deleteRule: row.delete_rule,
      });
    }
  }

  return Array.from(fkMap.entries()).map(([name, fk]) => {
    const columns = fk.columns.map((c) => `"${c}"`).join(', ');
    const foreignColumns = fk.foreignColumns.map((c) => `"${c}"`).join(', ');

    let ddl = `ALTER TABLE "${targetSchema}"."${tableName}" `;
    ddl += `ADD CONSTRAINT "${name}" FOREIGN KEY (${columns}) `;
    ddl += `REFERENCES "${targetSchema}"."${fk.foreignTable}" (${foreignColumns})`;

    if (fk.updateRule !== 'NO ACTION') {
      ddl += ` ON UPDATE ${fk.updateRule}`;
    }
    if (fk.deleteRule !== 'NO ACTION') {
      ddl += ` ON DELETE ${fk.deleteRule}`;
    }

    return ddl;
  });
}

/**
 * Generate unique constraint DDLs
 */
export async function generateUniqueDdls(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<string[]> {
  const result = await pool.query<{
    constraint_name: string;
    column_name: string;
  }>(
    `SELECT
      tc.constraint_name,
      kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'UNIQUE'
     ORDER BY tc.constraint_name, kcu.ordinal_position`,
    [schemaName, tableName]
  );

  const uniqueMap = new Map<string, string[]>();
  for (const row of result.rows) {
    const existing = uniqueMap.get(row.constraint_name);
    if (existing) {
      existing.push(row.column_name);
    } else {
      uniqueMap.set(row.constraint_name, [row.column_name]);
    }
  }

  return Array.from(uniqueMap.entries()).map(([name, columns]) => {
    const cols = columns.map((c) => `"${c}"`).join(', ');
    return `ALTER TABLE "${tableName}" ADD CONSTRAINT "${name}" UNIQUE (${cols})`;
  });
}

/**
 * Generate check constraint DDLs
 */
export async function generateCheckDdls(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<string[]> {
  const result = await pool.query<{
    constraint_name: string;
    check_clause: string;
  }>(
    `SELECT
      tc.constraint_name,
      cc.check_clause
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc
       ON tc.constraint_name = cc.constraint_name
       AND tc.constraint_schema = cc.constraint_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'CHECK'
       AND tc.constraint_name NOT LIKE '%_not_null'`,
    [schemaName, tableName]
  );

  return result.rows.map(
    (row) => `ALTER TABLE "${tableName}" ADD CONSTRAINT "${row.constraint_name}" CHECK (${row.check_clause})`,
  );
}

/**
 * Get row count for a table
 */
export async function getRowCount(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM "${schemaName}"."${tableName}"`,
  );
  return parseInt(result.rows[0]!.count, 10);
}

/**
 * Generate complete clone information for a table
 */
export async function generateTableCloneInfo(
  pool: Pool,
  sourceSchema: string,
  targetSchema: string,
  tableName: string
): Promise<TableCloneInfo> {
  const [createDdl, indexDdls, pkDdl, uniqueDdls, checkDdls, fkDdls, rowCount] = await Promise.all([
    generateTableDdl(pool, sourceSchema, tableName),
    generateIndexDdls(pool, sourceSchema, targetSchema, tableName),
    generatePrimaryKeyDdl(pool, sourceSchema, tableName),
    generateUniqueDdls(pool, sourceSchema, tableName),
    generateCheckDdls(pool, sourceSchema, tableName),
    generateForeignKeyDdls(pool, sourceSchema, targetSchema, tableName),
    getRowCount(pool, sourceSchema, tableName),
  ]);

  return {
    name: tableName,
    createDdl,
    indexDdls,
    constraintDdls: [
      ...(pkDdl ? [pkDdl] : []),
      ...uniqueDdls,
      ...checkDdls,
      ...fkDdls,
    ],
    rowCount,
  };
}
