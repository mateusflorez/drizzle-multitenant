/**
 * Convention Rules
 *
 * Rules for validating schema best practices and conventions.
 */

import type { LintRule, SchemaColumn, SchemaTable, RuleContext } from '../types.js';

/**
 * Require primary key rule
 *
 * Every table should have a primary key defined.
 */
export const requirePrimaryKeyRule: LintRule = {
  name: 'require-primary-key',
  description: 'Require every table to have a primary key',
  defaultSeverity: 'error',

  validateTable(table: SchemaTable, context: RuleContext): void {
    const hasPrimaryKey = table.columns.some((col) => col.isPrimaryKey);

    if (!hasPrimaryKey) {
      context.report({
        message: `Table "${table.name}" does not have a primary key`,
        filePath: table.filePath,
        table: table.name,
        suggestion: 'Add a primary key column (e.g., id: uuid().primaryKey())',
      });
    }
  },
};

/**
 * Prefer UUID primary key rule
 *
 * Recommends using UUID over serial/integer for primary keys.
 */
export const preferUuidPkRule: LintRule = {
  name: 'prefer-uuid-pk',
  description: 'Prefer UUID over serial/integer for primary keys',
  defaultSeverity: 'warn',

  validateColumn(column: SchemaColumn, table: SchemaTable, context: RuleContext): void {
    if (!column.isPrimaryKey) return;

    const nonUuidTypes = ['serial', 'bigserial', 'smallserial', 'integer', 'bigint', 'smallint'];
    const dataTypeLower = column.dataType.toLowerCase();

    if (nonUuidTypes.some((t) => dataTypeLower.includes(t))) {
      context.report({
        message: `Table "${table.name}" uses ${column.dataType} for primary key instead of UUID`,
        filePath: table.filePath,
        table: table.name,
        column: column.name,
        suggestion: 'Consider using uuid() for better distribution and security',
      });
    }
  },
};

/**
 * Require timestamps rule
 *
 * Tables should have created_at and updated_at columns.
 */
export const requireTimestampsRule: LintRule = {
  name: 'require-timestamps',
  description: 'Require timestamp columns (created_at, updated_at) on tables',
  defaultSeverity: 'warn',

  validateTable(table: SchemaTable, context: RuleContext): void {
    const options = context.options as { columns?: string[] };
    const requiredColumns = options.columns ?? ['created_at', 'updated_at'];

    const columnNames = table.columns.map((col) => col.name.toLowerCase());

    for (const required of requiredColumns) {
      // Check both snake_case and camelCase variants
      const snakeCase = required.toLowerCase();
      const camelCase = required.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()).toLowerCase();

      if (!columnNames.includes(snakeCase) && !columnNames.includes(camelCase)) {
        context.report({
          message: `Table "${table.name}" is missing "${required}" column`,
          filePath: table.filePath,
          table: table.name,
          suggestion: `Add ${snakeCase}: timestamp('${snakeCase}').defaultNow().notNull()`,
        });
      }
    }
  },
};

/**
 * Index foreign keys rule
 *
 * Foreign key columns should have indexes for query performance.
 */
export const indexForeignKeysRule: LintRule = {
  name: 'index-foreign-keys',
  description: 'Require indexes on foreign key columns',
  defaultSeverity: 'warn',

  validateTable(table: SchemaTable, context: RuleContext): void {
    // Find all foreign key columns
    const fkColumns = table.columns.filter((col) => col.references);

    // Get all indexed columns
    const indexedColumns = new Set<string>();
    for (const index of table.indexes) {
      // The first column of a composite index is considered indexed
      const firstColumn = index.columns[0];
      if (firstColumn) {
        indexedColumns.add(firstColumn.toLowerCase());
      }
    }

    // Primary key is implicitly indexed
    const pkColumns = table.columns.filter((col) => col.isPrimaryKey);
    for (const pk of pkColumns) {
      indexedColumns.add(pk.name.toLowerCase());
    }

    // Check each FK column
    for (const fkCol of fkColumns) {
      if (!indexedColumns.has(fkCol.name.toLowerCase())) {
        context.report({
          message: `Foreign key column "${fkCol.name}" in table "${table.name}" is not indexed`,
          filePath: table.filePath,
          table: table.name,
          column: fkCol.name,
          suggestion: `Add index: index('${table.name}_${fkCol.name}_idx').on(${table.name}.${fkCol.name})`,
        });
      }
    }
  },
};

/**
 * All convention rules
 */
export const conventionRules: LintRule[] = [
  requirePrimaryKeyRule,
  preferUuidPkRule,
  requireTimestampsRule,
  indexForeignKeysRule,
];
