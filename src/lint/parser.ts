/**
 * Schema Parser
 *
 * Parses Drizzle ORM schema files to extract table, column, and index information
 * for linting purposes.
 */

import type { SchemaTable, SchemaColumn, SchemaIndex, SchemaFileInfo } from './types.js';

/**
 * Drizzle table symbol for identifying tables
 */
const DRIZZLE_TABLE_SYMBOL = Symbol.for('drizzle:Table');

/**
 * Drizzle column symbol for identifying columns
 */
const DRIZZLE_COLUMN_SYMBOL = Symbol.for('drizzle:Column');

/**
 * Check if an object is a Drizzle table
 */
function isDrizzleTable(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;

  // Check for pgTable structure
  const table = obj as Record<string, unknown>;

  // Drizzle tables have a _ property with table metadata
  if (table._ && typeof table._ === 'object') {
    const meta = table._ as Record<string, unknown>;
    return (
      typeof meta.name === 'string' &&
      (meta.schema === undefined || typeof meta.schema === 'string')
    );
  }

  // Alternative check: has Symbol.for('drizzle:Table')
  if (Object.getOwnPropertySymbols(table).some((s) => s === DRIZZLE_TABLE_SYMBOL)) {
    return true;
  }

  return false;
}

/**
 * Check if an object is a Drizzle column
 */
function isDrizzleColumn(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;

  const col = obj as Record<string, unknown>;

  // Drizzle columns have specific properties
  return (
    typeof col.name === 'string' ||
    typeof col.columnType === 'string' ||
    typeof col.dataType === 'string' ||
    Object.getOwnPropertySymbols(col).some((s) => s === DRIZZLE_COLUMN_SYMBOL)
  );
}

/**
 * Extract column information from a Drizzle column object
 */
function extractColumnInfo(name: string, col: Record<string, unknown>): SchemaColumn {
  // Get the actual column name (might be different from property name)
  const columnName = (col.name as string) ?? name;

  // Get data type
  let dataType = 'unknown';
  if (typeof col.dataType === 'string') {
    dataType = col.dataType;
  } else if (typeof col.columnType === 'string') {
    dataType = col.columnType;
  } else if (typeof col.getSQLType === 'function') {
    try {
      dataType = col.getSQLType() as string;
    } catch {
      // Ignore errors
    }
  }

  // Check for primary key
  const isPrimaryKey =
    col.primary === true ||
    col.isPrimaryKey === true ||
    (typeof col.primaryKey === 'function' && col._isPrimaryKey === true);

  // Check for nullable
  const isNullable = col.notNull !== true && col.isNotNull !== true;

  // Check for default
  const hasDefault = col.hasDefault === true || col.default !== undefined;
  const defaultValue = col.default !== undefined ? String(col.default) : null;

  // Check for references (foreign keys)
  let references: SchemaColumn['references'] = undefined;
  if (col.references && typeof col.references === 'object') {
    const ref = col.references as Record<string, unknown>;
    references = {
      table: (ref.table as string) ?? 'unknown',
      column: (ref.column as string) ?? 'unknown',
      onDelete: ref.onDelete as string | undefined,
      onUpdate: ref.onUpdate as string | undefined,
    };
  }

  return {
    name: columnName,
    dataType,
    isPrimaryKey,
    isNullable,
    hasDefault,
    defaultValue,
    references,
  };
}

/**
 * Extract index information from a Drizzle table
 */
function extractIndexes(table: Record<string, unknown>): SchemaIndex[] {
  const indexes: SchemaIndex[] = [];

  // Check for _indexes property
  const tableIndexes = table._indexes ?? table.indexes;
  if (tableIndexes && typeof tableIndexes === 'object') {
    for (const [indexName, indexDef] of Object.entries(
      tableIndexes as Record<string, unknown>
    )) {
      if (!indexDef || typeof indexDef !== 'object') continue;

      const idx = indexDef as Record<string, unknown>;
      const columns: string[] = [];

      // Extract columns from index
      if (Array.isArray(idx.columns)) {
        for (const col of idx.columns) {
          if (typeof col === 'string') {
            columns.push(col);
          } else if (col && typeof col === 'object' && 'name' in col) {
            columns.push(String(col.name));
          }
        }
      }

      indexes.push({
        name: indexName,
        columns,
        isUnique: idx.isUnique === true || idx.unique === true,
      });
    }
  }

  return indexes;
}

/**
 * Parse a Drizzle schema module to extract table information
 */
export function parseSchemaModule(
  module: Record<string, unknown>,
  filePath: string,
  schemaType: 'tenant' | 'shared'
): SchemaTable[] {
  const tables: SchemaTable[] = [];

  for (const [exportName, exportValue] of Object.entries(module)) {
    if (!isDrizzleTable(exportValue)) continue;

    const table = exportValue as Record<string, unknown>;
    const tableMeta = table._ as Record<string, unknown> | undefined;
    const tableName = (tableMeta?.name as string) ?? exportName;

    // Extract columns
    const columns: SchemaColumn[] = [];
    for (const [propName, propValue] of Object.entries(table)) {
      if (propName === '_' || propName.startsWith('_')) continue;
      if (!isDrizzleColumn(propValue)) continue;

      const colInfo = extractColumnInfo(propName, propValue as Record<string, unknown>);
      columns.push(colInfo);
    }

    // Extract indexes
    const indexes = extractIndexes(table);

    tables.push({
      name: tableName,
      schemaType,
      columns,
      indexes,
      filePath,
    });
  }

  return tables;
}

/**
 * Parse a raw table definition (for testing or direct input)
 */
export function parseRawTable(
  name: string,
  columns: Array<{
    name: string;
    dataType: string;
    isPrimaryKey?: boolean;
    isNullable?: boolean;
    hasDefault?: boolean;
    defaultValue?: string | null;
    references?: SchemaColumn['references'];
  }>,
  options?: {
    schemaType?: 'tenant' | 'shared';
    filePath?: string;
    indexes?: Array<{ name: string; columns: string[]; isUnique?: boolean }>;
  }
): SchemaTable {
  return {
    name,
    schemaType: options?.schemaType ?? 'tenant',
    filePath: options?.filePath ?? 'unknown',
    columns: columns.map((col) => ({
      name: col.name,
      dataType: col.dataType,
      isPrimaryKey: col.isPrimaryKey ?? false,
      isNullable: col.isNullable ?? true,
      hasDefault: col.hasDefault ?? false,
      defaultValue: col.defaultValue ?? null,
      references: col.references,
    })),
    indexes:
      options?.indexes?.map((idx) => ({
        name: idx.name,
        columns: idx.columns,
        isUnique: idx.isUnique ?? false,
      })) ?? [],
  };
}

/**
 * Find schema files in a directory
 */
export async function findSchemaFiles(
  dir: string,
  type: 'tenant' | 'shared'
): Promise<SchemaFileInfo[]> {
  const { glob } = await import('glob');
  const { resolve } = await import('node:path');

  const pattern = resolve(dir, '**/*.ts');
  const files = await glob(pattern, {
    ignore: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
  });

  return files.map((filePath) => ({
    filePath,
    type,
  }));
}

/**
 * Load and parse a schema file
 */
export async function loadSchemaFile(
  filePath: string,
  type: 'tenant' | 'shared'
): Promise<SchemaTable[]> {
  try {
    // Dynamic import of the schema file
    const module = (await import(filePath)) as Record<string, unknown>;
    return parseSchemaModule(module, filePath, type);
  } catch (error) {
    // If we can't import, return empty (file might have syntax errors)
    console.warn(`Warning: Could not parse schema file ${filePath}:`, (error as Error).message);
    return [];
  }
}
