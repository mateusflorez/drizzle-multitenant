/**
 * Schema template generator
 *
 * @module scaffold/templates/schema-template
 */

import type { SchemaTemplateContext } from '../types.js';

/**
 * Generate a Drizzle schema file content
 *
 * @param context - Template context
 * @returns Generated TypeScript code for the schema
 *
 * @example
 * ```typescript
 * const content = generateSchemaTemplate({
 *   tableName: 'orders',
 *   tableNamePascal: 'Orders',
 *   tableNameCamel: 'orders',
 *   type: 'tenant',
 *   includeTimestamps: true,
 *   includeSoftDelete: false,
 *   useUuid: true,
 *   includeExample: true,
 * });
 * ```
 */
export function generateSchemaTemplate(context: SchemaTemplateContext): string {
  const { tableName, tableNamePascal, tableNameCamel, type } = context;

  const imports = buildImports(context);
  const columns = buildColumns(context);
  const indexes = buildIndexes(context);
  const relations = buildRelations(context);
  const typeExports = buildTypeExports(context);

  return `/**
 * ${tableNamePascal} schema
 * Type: ${type}
 *
 * @module schema/${type}/${tableNameCamel}
 */

${imports}

/**
 * ${tableNamePascal} table definition
 */
export const ${tableNameCamel} = pgTable('${tableName}', {
${columns}
});

${indexes}
${relations}
${typeExports}
`;
}

function buildImports(context: SchemaTemplateContext): string {
  const { includeTimestamps, includeSoftDelete, useUuid, includeExample } = context;

  const pgCoreImports: string[] = ['pgTable'];

  // Primary key type
  if (useUuid) {
    pgCoreImports.push('uuid');
  } else {
    pgCoreImports.push('serial');
  }

  // Common types
  pgCoreImports.push('text');

  // Example columns
  if (includeExample) {
    pgCoreImports.push('varchar', 'boolean');
  }

  // Timestamps
  if (includeTimestamps || includeSoftDelete) {
    pgCoreImports.push('timestamp');
  }

  // Indexes
  pgCoreImports.push('index');

  const uniqueImports = [...new Set(pgCoreImports)].sort();

  return `import { ${uniqueImports.join(', ')} } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';`;
}

function buildColumns(context: SchemaTemplateContext): string {
  const {
    includeTimestamps,
    includeSoftDelete,
    useUuid,
    includeExample,
  } = context;

  const columns: string[] = [];

  // Primary key
  if (useUuid) {
    columns.push("  id: uuid('id').primaryKey().defaultRandom(),");
  } else {
    columns.push("  id: serial('id').primaryKey(),");
  }

  // Example columns based on type
  if (includeExample) {
    columns.push("  name: varchar('name', { length: 255 }).notNull(),");
    columns.push("  description: text('description'),");
    columns.push("  isActive: boolean('is_active').notNull().default(true),");
  }

  // Timestamps
  if (includeTimestamps) {
    columns.push("  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),");
    columns.push("  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),");
  }

  // Soft delete
  if (includeSoftDelete) {
    columns.push("  deletedAt: timestamp('deleted_at', { withTimezone: true }),");
  }

  return columns.join('\n');
}

function buildIndexes(context: SchemaTemplateContext): string {
  const { tableNameCamel, tableName, includeExample, includeTimestamps } = context;

  const indexes: string[] = [];

  if (includeExample) {
    indexes.push(`  nameIdx: index('${tableName}_name_idx').on(${tableNameCamel}.name),`);
    indexes.push(`  isActiveIdx: index('${tableName}_is_active_idx').on(${tableNameCamel}.isActive),`);
  }

  if (includeTimestamps) {
    indexes.push(`  createdAtIdx: index('${tableName}_created_at_idx').on(${tableNameCamel}.createdAt),`);
  }

  if (indexes.length === 0) {
    return '';
  }

  return `/**
 * ${context.tableNamePascal} table indexes
 */
export const ${tableNameCamel}Indexes = {
${indexes.join('\n')}
};
`;
}

function buildRelations(context: SchemaTemplateContext): string {
  // Relations are commented out as a template for the user to fill in
  return `// Uncomment and modify to add relations
// import { relations } from 'drizzle-orm';
//
// export const ${context.tableNameCamel}Relations = relations(${context.tableNameCamel}, ({ one, many }) => ({
//   // Add your relations here
//   // user: one(users, {
//   //   fields: [${context.tableNameCamel}.userId],
//   //   references: [users.id],
//   // }),
// }));
`;
}

function buildTypeExports(context: SchemaTemplateContext): string {
  const { tableNameCamel, tableNamePascal } = context;

  return `/**
 * Zod schemas for validation
 */
export const insert${tableNamePascal}Schema = createInsertSchema(${tableNameCamel});
export const select${tableNamePascal}Schema = createSelectSchema(${tableNameCamel});

/**
 * TypeScript types inferred from schema
 */
export type ${tableNamePascal} = typeof ${tableNameCamel}.$inferSelect;
export type New${tableNamePascal} = typeof ${tableNameCamel}.$inferInsert;

/**
 * Zod types
 */
export type Insert${tableNamePascal} = z.infer<typeof insert${tableNamePascal}Schema>;
export type Select${tableNamePascal} = z.infer<typeof select${tableNamePascal}Schema>;
`;
}
