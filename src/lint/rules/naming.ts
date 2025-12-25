/**
 * Naming Convention Rules
 *
 * Rules for validating table and column naming conventions.
 */

import type { LintRule, NamingStyle, SchemaColumn, SchemaTable, RuleContext } from '../types.js';

/**
 * Check if a name follows snake_case convention
 */
function isSnakeCase(name: string): boolean {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name);
}

/**
 * Check if a name follows camelCase convention
 */
function isCamelCase(name: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(name) && !name.includes('_');
}

/**
 * Check if a name follows PascalCase convention
 */
function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name) && !name.includes('_');
}

/**
 * Check if a name follows kebab-case convention
 */
function isKebabCase(name: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
}

/**
 * Validate naming style
 */
function matchesNamingStyle(name: string, style: NamingStyle): boolean {
  switch (style) {
    case 'snake_case':
      return isSnakeCase(name);
    case 'camelCase':
      return isCamelCase(name);
    case 'PascalCase':
      return isPascalCase(name);
    case 'kebab-case':
      return isKebabCase(name);
    default:
      return true;
  }
}

/**
 * Convert a name to the expected style (for suggestions)
 */
function toNamingStyle(name: string, style: NamingStyle): string {
  // First normalize to words
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase/PascalCase to snake
    .replace(/-/g, '_') // kebab to snake
    .toLowerCase()
    .split('_')
    .filter(Boolean);

  switch (style) {
    case 'snake_case':
      return words.join('_');
    case 'camelCase':
      return words
        .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
        .join('');
    case 'PascalCase':
      return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
    case 'kebab-case':
      return words.join('-');
    default:
      return name;
  }
}

/**
 * Check if name matches any exception pattern
 */
function matchesException(name: string, exceptions?: string[]): boolean {
  if (!exceptions?.length) return false;
  return exceptions.some((pattern) => {
    // Simple glob-like matching
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(name);
  });
}

/**
 * Table naming rule
 *
 * Validates that table names follow the configured naming convention.
 */
export const tableNamingRule: LintRule = {
  name: 'table-naming',
  description: 'Enforce consistent table naming convention',
  defaultSeverity: 'warn',

  validateTable(table: SchemaTable, context: RuleContext): void {
    const options = context.options as { style?: NamingStyle; exceptions?: string[] };
    const style = options.style ?? 'snake_case';
    const exceptions = options.exceptions ?? [];

    if (matchesException(table.name, exceptions)) {
      return;
    }

    if (!matchesNamingStyle(table.name, style)) {
      const suggestion = toNamingStyle(table.name, style);
      context.report({
        message: `Table "${table.name}" does not follow ${style} convention`,
        filePath: table.filePath,
        table: table.name,
        suggestion: `Consider renaming to "${suggestion}"`,
      });
    }
  },
};

/**
 * Column naming rule
 *
 * Validates that column names follow the configured naming convention.
 */
export const columnNamingRule: LintRule = {
  name: 'column-naming',
  description: 'Enforce consistent column naming convention',
  defaultSeverity: 'warn',

  validateColumn(column: SchemaColumn, table: SchemaTable, context: RuleContext): void {
    const options = context.options as { style?: NamingStyle; exceptions?: string[] };
    const style = options.style ?? 'snake_case';
    const exceptions = options.exceptions ?? [];

    if (matchesException(column.name, exceptions)) {
      return;
    }

    if (!matchesNamingStyle(column.name, style)) {
      const suggestion = toNamingStyle(column.name, style);
      context.report({
        message: `Column "${column.name}" in table "${table.name}" does not follow ${style} convention`,
        filePath: table.filePath,
        table: table.name,
        column: column.name,
        suggestion: `Consider renaming to "${suggestion}"`,
      });
    }
  },
};

/**
 * All naming rules
 */
export const namingRules: LintRule[] = [tableNamingRule, columnNamingRule];
