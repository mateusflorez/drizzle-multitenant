/**
 * Security Rules
 *
 * Rules for validating schema security best practices.
 */

import type { LintRule, SchemaColumn, SchemaTable, RuleContext } from '../types.js';

/**
 * No cascade delete rule
 *
 * Warns about CASCADE DELETE which can accidentally remove data.
 */
export const noCascadeDeleteRule: LintRule = {
  name: 'no-cascade-delete',
  description: 'Warn about CASCADE DELETE on foreign keys',
  defaultSeverity: 'warn',

  validateColumn(column: SchemaColumn, table: SchemaTable, context: RuleContext): void {
    if (!column.references) return;

    const onDelete = column.references.onDelete?.toLowerCase();

    if (onDelete === 'cascade') {
      context.report({
        message: `Foreign key "${column.name}" in table "${table.name}" uses CASCADE DELETE`,
        filePath: table.filePath,
        table: table.name,
        column: column.name,
        suggestion:
          'Consider using SET NULL, RESTRICT, or implementing soft delete to prevent accidental data loss',
      });
    }
  },
};

/**
 * Require soft delete rule
 *
 * Tables should have a soft delete column instead of hard deletes.
 */
export const requireSoftDeleteRule: LintRule = {
  name: 'require-soft-delete',
  description: 'Require soft delete column on tables',
  defaultSeverity: 'off',

  validateTable(table: SchemaTable, context: RuleContext): void {
    const options = context.options as { column?: string };
    const softDeleteColumn = options.column ?? 'deleted_at';

    // Check both snake_case and camelCase variants
    const snakeCase = softDeleteColumn.toLowerCase();
    const camelCase = softDeleteColumn.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()).toLowerCase();

    const columnNames = table.columns.map((col) => col.name.toLowerCase());

    if (!columnNames.includes(snakeCase) && !columnNames.includes(camelCase)) {
      context.report({
        message: `Table "${table.name}" does not have a soft delete column ("${softDeleteColumn}")`,
        filePath: table.filePath,
        table: table.name,
        suggestion: `Add ${snakeCase}: timestamp('${snakeCase}') for soft delete support`,
      });
    }
  },
};

/**
 * All security rules
 */
export const securityRules: LintRule[] = [noCascadeDeleteRule, requireSoftDeleteRule];
