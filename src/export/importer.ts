/**
 * Schema Importer
 *
 * Imports schema definitions from JSON and generates Drizzle ORM
 * schema files. Useful for sharing schemas between projects or
 * reconstructing schemas from documentation.
 */

import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  SchemaExport,
  ExportedTable,
  ImportOptions,
  ImportResult,
  ISchemaImporter,
} from './types.js';

/**
 * Map JSON/exported data types back to Drizzle pg-core imports
 */
function mapDataTypeToDrizzle(dataType: string): {
  import: string;
  usage: string;
} {
  const type = dataType.toLowerCase();

  // UUID
  if (type === 'uuid') {
    return { import: 'uuid', usage: "uuid('$name')" };
  }

  // Text
  if (type === 'text' || type === 'string') {
    return { import: 'text', usage: "text('$name')" };
  }

  // Varchar
  if (type.startsWith('varchar') || type.startsWith('character varying')) {
    const match = type.match(/\((\d+)\)/);
    const length = match ? match[1] : '255';
    return { import: 'varchar', usage: `varchar('$name', { length: ${length} })` };
  }

  // Char
  if (type.startsWith('char') || type.startsWith('character')) {
    const match = type.match(/\((\d+)\)/);
    const length = match ? match[1] : '1';
    return { import: 'char', usage: `char('$name', { length: ${length} })` };
  }

  // Integer
  if (type === 'integer' || type === 'int' || type === 'int4') {
    return { import: 'integer', usage: "integer('$name')" };
  }

  // Smallint
  if (type === 'smallint' || type === 'int2') {
    return { import: 'smallint', usage: "smallint('$name')" };
  }

  // Bigint
  if (type === 'bigint' || type === 'int8') {
    return { import: 'bigint', usage: "bigint('$name', { mode: 'number' })" };
  }

  // Serial
  if (type === 'serial' || type === 'serial4') {
    return { import: 'serial', usage: "serial('$name')" };
  }

  // Bigserial
  if (type === 'bigserial' || type === 'serial8') {
    return { import: 'bigserial', usage: "bigserial('$name', { mode: 'number' })" };
  }

  // Real/Float
  if (type === 'real' || type === 'float4' || type === 'float') {
    return { import: 'real', usage: "real('$name')" };
  }

  // Double precision
  if (type === 'double precision' || type === 'float8' || type === 'double') {
    return { import: 'doublePrecision', usage: "doublePrecision('$name')" };
  }

  // Numeric/Decimal
  if (type.startsWith('numeric') || type.startsWith('decimal')) {
    const match = type.match(/\((\d+)(?:,\s*(\d+))?\)/);
    const precision = match?.[1] ?? '10';
    const scale = match?.[2] ?? '2';
    return {
      import: 'numeric',
      usage: `numeric('$name', { precision: ${precision}, scale: ${scale} })`,
    };
  }

  // Boolean
  if (type === 'boolean' || type === 'bool') {
    return { import: 'boolean', usage: "boolean('$name')" };
  }

  // Date
  if (type === 'date') {
    return { import: 'date', usage: "date('$name')" };
  }

  // Timestamp
  if (type.startsWith('timestamp')) {
    const withTz = type.includes('with time zone') || type.includes('timestamptz');
    return {
      import: 'timestamp',
      usage: withTz
        ? "timestamp('$name', { withTimezone: true })"
        : "timestamp('$name')",
    };
  }

  // Time
  if (type === 'time' || type.startsWith('time ')) {
    const withTz = type.includes('with time zone');
    return {
      import: 'time',
      usage: withTz ? "time('$name', { withTimezone: true })" : "time('$name')",
    };
  }

  // JSON
  if (type === 'json') {
    return { import: 'json', usage: "json('$name')" };
  }

  // JSONB
  if (type === 'jsonb') {
    return { import: 'jsonb', usage: "jsonb('$name')" };
  }

  // Bytea
  if (type === 'bytea') {
    return { import: 'customType', usage: "bytea('$name')" };
  }

  // Default to text for unknown types
  return { import: 'text', usage: "text('$name')" };
}

/**
 * Convert table name to PascalCase for export names
 */
function toPascalCase(name: string): string {
  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

/**
 * Convert table name to camelCase for variable names
 */
function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Generate a Drizzle schema file from a table definition
 */
function generateSchemaFile(table: ExportedTable, options: ImportOptions): string {
  const lines: string[] = [];

  // Collect required imports
  const imports = new Set<string>();
  imports.add('pgTable');

  for (const column of table.columns) {
    const { import: importName } = mapDataTypeToDrizzle(column.dataType);
    imports.add(importName);
  }

  // Add index import if there are indexes
  if (table.indexes.length > 0) {
    imports.add('index');
    const hasUnique = table.indexes.some((idx) => idx.isUnique);
    if (hasUnique) {
      imports.add('uniqueIndex');
    }
  }

  // Header comment
  lines.push('/**');
  lines.push(` * ${table.name} schema`);
  lines.push(' * Auto-generated from schema import');
  lines.push(` * Schema type: ${table.schemaType}`);
  lines.push(' */');
  lines.push('');

  // Imports
  lines.push(`import { ${Array.from(imports).sort().join(', ')} } from 'drizzle-orm/pg-core';`);

  if (options.includeZod) {
    lines.push("import { createInsertSchema, createSelectSchema } from 'drizzle-zod';");
    lines.push("import { z } from 'zod';");
  }

  lines.push('');

  // Collect foreign key references for later imports
  const references = table.columns
    .filter((col) => col.references)
    .map((col) => col.references!);

  // Add relation table imports (placeholder - user will need to adjust paths)
  if (references.length > 0) {
    const uniqueTables = [...new Set(references.map((ref) => ref.table))];
    for (const refTable of uniqueTables) {
      if (refTable !== table.name) {
        lines.push(
          `// TODO: Adjust import path for ${refTable}`
        );
        lines.push(`// import { ${toCamelCase(refTable)} } from './${refTable}';`);
      }
    }
    lines.push('');
  }

  // Table definition
  const tableName = toCamelCase(table.name);
  lines.push(`export const ${tableName} = pgTable('${table.name}', {`);

  // Columns
  const columnCount = table.columns.length;
  table.columns.forEach((column, i) => {
    const { usage } = mapDataTypeToDrizzle(column.dataType);
    const isLast = i === columnCount - 1;

    let columnDef = usage.replace('$name', column.name);

    // Add modifiers
    const modifiers: string[] = [];

    if (column.isPrimaryKey) {
      modifiers.push('.primaryKey()');
      // Add default for UUID primary keys
      if (column.dataType.toLowerCase() === 'uuid') {
        modifiers.push('.defaultRandom()');
      }
    }

    if (!column.isNullable && !column.isPrimaryKey) {
      modifiers.push('.notNull()');
    }

    if (column.hasDefault && column.defaultValue != null && column.defaultValue !== '' && !column.isPrimaryKey) {
      const defaultVal = column.defaultValue;
      if (defaultVal === 'now()' || defaultVal === 'CURRENT_TIMESTAMP') {
        modifiers.push('.defaultNow()');
      } else if (defaultVal === 'true' || defaultVal === 'false') {
        modifiers.push(`.default(${defaultVal})`);
      } else if (!isNaN(Number(defaultVal))) {
        modifiers.push(`.default(${defaultVal})`);
      } else if (defaultVal.startsWith("'") && defaultVal.endsWith("'")) {
        modifiers.push(`.default(${defaultVal})`);
      }
    }

    if (column.references) {
      // Add references (commented out - user needs to uncomment and adjust)
      modifiers.push(
        `// .references(() => ${toCamelCase(column.references.table)}.${column.references.column})`
      );
    }

    columnDef += modifiers.join('');
    lines.push(`  ${column.name}: ${columnDef}${isLast ? '' : ','}`);
  });

  lines.push('});');
  lines.push('');

  // Index definitions
  if (table.indexes.length > 0) {
    lines.push(`export const ${tableName}Indexes = {`);
    const indexCount = table.indexes.length;
    table.indexes.forEach((idx, i) => {
      const isLast = i === indexCount - 1;
      const indexType = idx.isUnique ? 'uniqueIndex' : 'index';
      const columns = idx.columns.map((c) => `${tableName}.${c}`).join(', ');
      lines.push(`  ${toCamelCase(idx.name)}: ${indexType}('${idx.name}').on(${columns})${isLast ? '' : ','}`);
    });
    lines.push('};');
    lines.push('');
  }

  // Zod schemas
  if (options.includeZod) {
    lines.push(`export const insert${toPascalCase(table.name)}Schema = createInsertSchema(${tableName});`);
    lines.push(`export const select${toPascalCase(table.name)}Schema = createSelectSchema(${tableName});`);
    lines.push('');
  }

  // TypeScript types
  if (options.includeTypes !== false) {
    lines.push(`export type ${toPascalCase(table.name)} = typeof ${tableName}.$inferSelect;`);
    lines.push(`export type New${toPascalCase(table.name)} = typeof ${tableName}.$inferInsert;`);
  }

  return lines.join('\n');
}

/**
 * Generate barrel export file
 */
function generateBarrelFile(tables: ExportedTable[]): string {
  const lines: string[] = [];

  lines.push('/**');
  lines.push(' * Barrel export for all schema files');
  lines.push(' * Auto-generated from schema import');
  lines.push(' */');
  lines.push('');

  for (const table of tables) {
    lines.push(`export * from './${table.name}';`);
  }

  return lines.join('\n');
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Schema Importer
 */
export class SchemaImporter implements ISchemaImporter {
  async import(schema: SchemaExport, options: ImportOptions): Promise<ImportResult> {
    const result: ImportResult = {
      success: true,
      filesCreated: [],
      filesSkipped: [],
      errors: [],
    };

    const outputDir = resolve(options.outputDir);

    // Create output directories
    const tenantDir = join(outputDir, 'tenant');
    const sharedDir = join(outputDir, 'shared');

    if (!options.dryRun) {
      await mkdir(tenantDir, { recursive: true });
      await mkdir(sharedDir, { recursive: true });
    }

    // Separate tables by type
    const tenantTables = schema.tables.filter((t) => t.schemaType === 'tenant');
    const sharedTables = schema.tables.filter((t) => t.schemaType === 'shared');

    // Generate tenant schemas
    if (options.generateTenant !== false) {
      for (const table of tenantTables) {
        const filePath = join(tenantDir, `${table.name}.ts`);

        try {
          if (!options.overwrite && (await fileExists(filePath))) {
            result.filesSkipped.push(filePath);
            continue;
          }

          const content = generateSchemaFile(table, options);

          if (!options.dryRun) {
            await writeFile(filePath, content, 'utf-8');
          }

          result.filesCreated.push(filePath);
        } catch (error) {
          result.success = false;
          result.errors.push({
            file: filePath,
            error: (error as Error).message,
          });
        }
      }

      // Generate tenant barrel file
      if (tenantTables.length > 0) {
        const barrelPath = join(tenantDir, 'index.ts');
        try {
          if (options.overwrite || !(await fileExists(barrelPath))) {
            const content = generateBarrelFile(tenantTables);
            if (!options.dryRun) {
              await writeFile(barrelPath, content, 'utf-8');
            }
            result.filesCreated.push(barrelPath);
          } else {
            result.filesSkipped.push(barrelPath);
          }
        } catch (error) {
          result.errors.push({
            file: barrelPath,
            error: (error as Error).message,
          });
        }
      }
    }

    // Generate shared schemas
    if (options.generateShared !== false) {
      for (const table of sharedTables) {
        const filePath = join(sharedDir, `${table.name}.ts`);

        try {
          if (!options.overwrite && (await fileExists(filePath))) {
            result.filesSkipped.push(filePath);
            continue;
          }

          const content = generateSchemaFile(table, options);

          if (!options.dryRun) {
            await writeFile(filePath, content, 'utf-8');
          }

          result.filesCreated.push(filePath);
        } catch (error) {
          result.success = false;
          result.errors.push({
            file: filePath,
            error: (error as Error).message,
          });
        }
      }

      // Generate shared barrel file
      if (sharedTables.length > 0) {
        const barrelPath = join(sharedDir, 'index.ts');
        try {
          if (options.overwrite || !(await fileExists(barrelPath))) {
            const content = generateBarrelFile(sharedTables);
            if (!options.dryRun) {
              await writeFile(barrelPath, content, 'utf-8');
            }
            result.filesCreated.push(barrelPath);
          } else {
            result.filesSkipped.push(barrelPath);
          }
        } catch (error) {
          result.errors.push({
            file: barrelPath,
            error: (error as Error).message,
          });
        }
      }
    }

    return result;
  }
}

/**
 * Create a schema importer instance
 */
export function createSchemaImporter(): SchemaImporter {
  return new SchemaImporter();
}

/**
 * Load schema export from a JSON file
 */
export async function loadSchemaExport(filePath: string): Promise<SchemaExport> {
  const content = await readFile(resolve(filePath), 'utf-8');
  return JSON.parse(content) as SchemaExport;
}
