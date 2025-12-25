/**
 * TypeScript Exporter
 *
 * Exports Drizzle schemas to TypeScript type definitions
 * for use in other projects or for documentation.
 */

import type {
  ExportedTable,
  ExportedColumn,
  ISchemaExporter,
  ExportOptions,
  TypeScriptExportOptions,
} from './types.js';

/**
 * Map PostgreSQL/Drizzle data types to TypeScript types
 */
function mapDataTypeToTypeScript(dataType: string, isNullable: boolean): string {
  const type = dataType.toLowerCase();
  let tsType: string;

  // UUID
  if (type === 'uuid') {
    tsType = 'string';
  }
  // Text types
  else if (type === 'text' || type === 'string') {
    tsType = 'string';
  }
  // Varchar/Char
  else if (
    type.startsWith('varchar') ||
    type.startsWith('character varying') ||
    type.startsWith('char') ||
    type.startsWith('character')
  ) {
    tsType = 'string';
  }
  // Integer types
  else if (
    type === 'integer' ||
    type === 'int' ||
    type === 'int4' ||
    type === 'smallint' ||
    type === 'int2' ||
    type === 'serial' ||
    type === 'serial4' ||
    type === 'smallserial' ||
    type === 'serial2'
  ) {
    tsType = 'number';
  }
  // Bigint (JavaScript bigint for safety)
  else if (type === 'bigint' || type === 'int8' || type === 'bigserial' || type === 'serial8') {
    tsType = 'string'; // Usually returned as string by pg driver
  }
  // Float types
  else if (
    type === 'real' ||
    type === 'float4' ||
    type === 'float' ||
    type === 'double precision' ||
    type === 'float8' ||
    type === 'double' ||
    type.startsWith('numeric') ||
    type.startsWith('decimal')
  ) {
    tsType = 'number';
  }
  // Boolean
  else if (type === 'boolean' || type === 'bool') {
    tsType = 'boolean';
  }
  // Date types
  else if (type === 'date') {
    tsType = 'string'; // ISO date string
  }
  // Timestamp
  else if (type.startsWith('timestamp')) {
    tsType = 'Date';
  }
  // Time
  else if (type === 'time' || type.startsWith('time ')) {
    tsType = 'string';
  }
  // Interval
  else if (type === 'interval') {
    tsType = 'string';
  }
  // JSON types
  else if (type === 'json' || type === 'jsonb') {
    tsType = 'unknown'; // Could be Record<string, unknown> but unknown is safer
  }
  // Array types
  else if (type.endsWith('[]')) {
    const baseType = type.slice(0, -2);
    const baseTsType = mapDataTypeToTypeScript(baseType, false);
    tsType = `${baseTsType}[]`;
  }
  // Enum types
  else if (type.startsWith('enum')) {
    tsType = 'string'; // Could be more specific if we had enum values
  }
  // Binary
  else if (type === 'bytea') {
    tsType = 'Buffer';
  }
  // Default
  else {
    tsType = 'unknown';
  }

  return isNullable ? `${tsType} | null` : tsType;
}

/**
 * Convert table name to TypeScript interface name (PascalCase)
 */
function toInterfaceName(tableName: string): string {
  return tableName
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

/**
 * Convert table name to camelCase for variable names
 */
function toCamelCase(tableName: string): string {
  const pascal = toInterfaceName(tableName);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Generate JSDoc comment for a column
 */
function generateColumnJsDoc(column: ExportedColumn): string | null {
  const lines: string[] = [];

  if (column.isPrimaryKey) {
    lines.push('Primary key');
  }

  if (column.references) {
    lines.push(`Foreign key to ${column.references.table}.${column.references.column}`);
  }

  if (column.hasDefault && column.defaultValue !== null) {
    lines.push(`Default: ${column.defaultValue}`);
  }

  if (lines.length === 0) return null;

  if (lines.length === 1) {
    return `  /** ${lines[0]} */`;
  }

  return ['  /**', ...lines.map((l) => `   * ${l}`), '   */'].join('\n');
}

/**
 * Generate TypeScript interface for a table
 */
function generateTableInterface(table: ExportedTable): string {
  const interfaceName = toInterfaceName(table.name);
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * ${table.name} table schema (${table.schemaType})`);
  lines.push(` */`);
  lines.push(`export interface ${interfaceName} {`);

  for (const column of table.columns) {
    const jsDoc = generateColumnJsDoc(column);
    if (jsDoc) {
      lines.push(jsDoc);
    }

    const tsType = mapDataTypeToTypeScript(column.dataType, column.isNullable);
    const optional = column.hasDefault || column.isNullable ? '?' : '';
    lines.push(`  ${column.name}${optional}: ${tsType};`);
  }

  lines.push(`}`);

  return lines.join('\n');
}

/**
 * Generate insert type (for create operations)
 */
function generateInsertType(table: ExportedTable): string {
  const interfaceName = toInterfaceName(table.name);
  const insertName = `New${interfaceName}`;

  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * Insert type for ${table.name}`);
  lines.push(` */`);
  lines.push(`export interface ${insertName} {`);

  for (const column of table.columns) {
    const tsType = mapDataTypeToTypeScript(column.dataType, column.isNullable);
    // For insert, columns with defaults are optional
    const optional = column.hasDefault || column.isNullable ? '?' : '';
    lines.push(`  ${column.name}${optional}: ${tsType};`);
  }

  lines.push(`}`);

  return lines.join('\n');
}

/**
 * Generate Zod schema for a table
 */
function generateZodSchema(table: ExportedTable): string {
  const schemaName = `${toCamelCase(table.name)}Schema`;
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Zod schema for ${table.name}`);
  lines.push(` */`);
  lines.push(`export const ${schemaName} = z.object({`);

  for (const column of table.columns) {
    let zodType = mapDataTypeToZod(column.dataType);

    if (column.isNullable) {
      zodType = `${zodType}.nullable()`;
    }

    if (column.hasDefault) {
      zodType = `${zodType}.optional()`;
    }

    lines.push(`  ${column.name}: ${zodType},`);
  }

  lines.push(`});`);
  lines.push('');
  lines.push(`export type ${toInterfaceName(table.name)}Validated = z.infer<typeof ${schemaName}>;`);

  return lines.join('\n');
}

/**
 * Map data type to Zod type
 */
function mapDataTypeToZod(dataType: string): string {
  const type = dataType.toLowerCase();

  if (type === 'uuid') {
    return 'z.string().uuid()';
  }

  if (type === 'text' || type === 'string') {
    return 'z.string()';
  }

  if (
    type.startsWith('varchar') ||
    type.startsWith('character varying') ||
    type.startsWith('char')
  ) {
    const match = type.match(/\((\d+)\)/);
    if (match) {
      return `z.string().max(${match[1]})`;
    }
    return 'z.string()';
  }

  if (
    type === 'integer' ||
    type === 'int' ||
    type === 'int4' ||
    type === 'smallint' ||
    type === 'serial'
  ) {
    return 'z.number().int()';
  }

  if (type === 'bigint' || type === 'int8' || type === 'bigserial') {
    return 'z.string()'; // Usually returned as string
  }

  if (
    type === 'real' ||
    type === 'float4' ||
    type === 'float' ||
    type === 'double precision' ||
    type.startsWith('numeric') ||
    type.startsWith('decimal')
  ) {
    return 'z.number()';
  }

  if (type === 'boolean' || type === 'bool') {
    return 'z.boolean()';
  }

  if (type === 'date') {
    return 'z.string().date()';
  }

  if (type.startsWith('timestamp')) {
    return 'z.date()';
  }

  if (type === 'json' || type === 'jsonb') {
    return 'z.unknown()';
  }

  if (type.endsWith('[]')) {
    const baseType = type.slice(0, -2);
    return `z.array(${mapDataTypeToZod(baseType)})`;
  }

  return 'z.unknown()';
}

/**
 * TypeScript Exporter
 */
export class TypeScriptExporter implements ISchemaExporter {
  export(tables: ExportedTable[], options: ExportOptions): string {
    const tsOptions: TypeScriptExportOptions = options.typescript ?? {};
    const lines: string[] = [];

    // Header
    lines.push('/**');
    lines.push(' * Auto-generated TypeScript types from Drizzle ORM schemas');
    lines.push(` * Generated at: ${new Date().toISOString()}`);
    if (options.projectName) {
      lines.push(` * Project: ${options.projectName}`);
    }
    lines.push(' */');
    lines.push('');

    // Zod import if needed
    if (tsOptions.includeZod) {
      lines.push("import { z } from 'zod';");
      lines.push('');
    }

    // Separate by schema type
    const tenantTables = tables.filter((t) => t.schemaType === 'tenant');
    const sharedTables = tables.filter((t) => t.schemaType === 'shared');

    // Generate tenant schemas
    if (tenantTables.length > 0) {
      lines.push('// ================================');
      lines.push('// Tenant Schema Types');
      lines.push('// ================================');
      lines.push('');

      for (const table of tenantTables) {
        // Main interface
        if (tsOptions.includeSelectTypes !== false) {
          lines.push(generateTableInterface(table));
          lines.push('');
        }

        // Insert type
        if (tsOptions.includeInsertTypes !== false) {
          lines.push(generateInsertType(table));
          lines.push('');
        }

        // Zod schema
        if (tsOptions.includeZod) {
          lines.push(generateZodSchema(table));
          lines.push('');
        }
      }
    }

    // Generate shared schemas
    if (sharedTables.length > 0) {
      lines.push('// ================================');
      lines.push('// Shared Schema Types');
      lines.push('// ================================');
      lines.push('');

      for (const table of sharedTables) {
        if (tsOptions.includeSelectTypes !== false) {
          lines.push(generateTableInterface(table));
          lines.push('');
        }

        if (tsOptions.includeInsertTypes !== false) {
          lines.push(generateInsertType(table));
          lines.push('');
        }

        if (tsOptions.includeZod) {
          lines.push(generateZodSchema(table));
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }
}

/**
 * Create a TypeScript exporter instance
 */
export function createTypeScriptExporter(): TypeScriptExporter {
  return new TypeScriptExporter();
}
