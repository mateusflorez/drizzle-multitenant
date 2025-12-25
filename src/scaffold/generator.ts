/**
 * Scaffold generator
 *
 * Orchestrates the generation of schema, seed, and migration files.
 *
 * @module scaffold/generator
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type {
  MigrationTemplate,
  ScaffoldMigrationOptions,
  ScaffoldResult,
  ScaffoldSchemaOptions,
  ScaffoldSeedOptions,
  SchemaTemplateContext,
  SeedTemplateContext,
  MigrationTemplateContext,
} from './types.js';

import { generateSchemaTemplate } from './templates/schema-template.js';
import { generateSeedTemplate } from './templates/seed-template.js';
import {
  generateMigrationTemplate,
  inferMigrationTemplate,
  inferTableName,
} from './templates/migration-template.js';

/**
 * Convert a name to various case formats
 */
export function toCase(name: string): {
  snake: string;
  pascal: string;
  camel: string;
} {
  // First normalize to snake_case
  const snake = name
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase to snake_case
    .replace(/[-\s]+/g, '_') // hyphens and spaces to underscores
    .toLowerCase();

  // Convert snake_case to PascalCase
  const pascal = snake
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  // Convert PascalCase to camelCase
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);

  return { snake, pascal, camel };
}

/**
 * Default output directories
 */
export const DEFAULT_DIRS = {
  schemaDir: 'src/db/schema',
  seedDir: 'drizzle/seeds',
  tenantMigrationsDir: 'drizzle/tenant-migrations',
  sharedMigrationsDir: 'drizzle/shared-migrations',
} as const;

/**
 * Scaffold a new Drizzle schema file
 *
 * @param options - Scaffold options
 * @returns Result of the scaffold operation
 *
 * @example
 * ```typescript
 * const result = await scaffoldSchema({
 *   name: 'orders',
 *   type: 'tenant',
 *   includeTimestamps: true,
 * });
 *
 * if (result.success) {
 *   console.log(`Created: ${result.filePath}`);
 * }
 * ```
 */
export async function scaffoldSchema(
  options: ScaffoldSchemaOptions
): Promise<ScaffoldResult> {
  const {
    name,
    type,
    outputDir,
    includeExample = true,
    includeTimestamps = true,
    includeSoftDelete = false,
    useUuid = true,
  } = options;

  try {
    const caseNames = toCase(name);

    const context: SchemaTemplateContext = {
      tableName: caseNames.snake,
      tableNamePascal: caseNames.pascal,
      tableNameCamel: caseNames.camel,
      type,
      includeTimestamps,
      includeSoftDelete,
      useUuid,
      includeExample,
    };

    const content = generateSchemaTemplate(context);

    // Determine output path
    const baseDir = outputDir || join(DEFAULT_DIRS.schemaDir, type);
    const fileName = `${caseNames.camel}.ts`;
    const filePath = resolve(process.cwd(), baseDir, fileName);

    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });

    // Check if file already exists
    if (existsSync(filePath)) {
      return {
        success: false,
        filePath,
        fileName,
        kind: 'schema',
        type,
        error: `File already exists: ${filePath}`,
      };
    }

    // Write file
    await writeFile(filePath, content, 'utf-8');

    return {
      success: true,
      filePath,
      fileName,
      kind: 'schema',
      type,
    };
  } catch (error) {
    return {
      success: false,
      filePath: '',
      fileName: '',
      kind: 'schema',
      type,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Scaffold a new seed file
 *
 * @param options - Scaffold options
 * @returns Result of the scaffold operation
 *
 * @example
 * ```typescript
 * const result = await scaffoldSeed({
 *   name: 'initial',
 *   type: 'tenant',
 *   tableName: 'users',
 * });
 * ```
 */
export async function scaffoldSeed(
  options: ScaffoldSeedOptions
): Promise<ScaffoldResult> {
  const { name, type, outputDir, tableName } = options;

  try {
    const caseNames = toCase(name);

    const context: SeedTemplateContext = {
      seedName: caseNames.camel,
      type,
      ...(tableName !== undefined && { tableName }),
    };

    const content = generateSeedTemplate(context);

    // Determine output path
    const baseDir = outputDir || join(DEFAULT_DIRS.seedDir, type);
    const fileName = `${caseNames.camel}.ts`;
    const filePath = resolve(process.cwd(), baseDir, fileName);

    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });

    // Check if file already exists
    if (existsSync(filePath)) {
      return {
        success: false,
        filePath,
        fileName,
        kind: 'seed',
        type,
        error: `File already exists: ${filePath}`,
      };
    }

    // Write file
    await writeFile(filePath, content, 'utf-8');

    return {
      success: true,
      filePath,
      fileName,
      kind: 'seed',
      type,
    };
  } catch (error) {
    return {
      success: false,
      filePath: '',
      fileName: '',
      kind: 'seed',
      type,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Scaffold a new migration file
 *
 * @param options - Scaffold options
 * @returns Result of the scaffold operation
 *
 * @example
 * ```typescript
 * const result = await scaffoldMigration({
 *   name: 'add-orders',
 *   type: 'tenant',
 *   template: 'create-table',
 * });
 * ```
 */
export async function scaffoldMigration(
  options: ScaffoldMigrationOptions
): Promise<ScaffoldResult> {
  const { name, type, outputDir, template } = options;

  try {
    // Determine base directory
    const defaultDir =
      type === 'shared'
        ? DEFAULT_DIRS.sharedMigrationsDir
        : DEFAULT_DIRS.tenantMigrationsDir;
    const baseDir = outputDir || defaultDir;
    const resolvedDir = resolve(process.cwd(), baseDir);

    // Ensure directory exists
    await mkdir(resolvedDir, { recursive: true });

    // Get next sequence number
    const files = existsSync(resolvedDir) ? await readdir(resolvedDir) : [];
    const sqlFiles = files.filter((f) => f.endsWith('.sql'));

    let maxSequence = 0;
    for (const file of sqlFiles) {
      const match = file.match(/^(\d+)_/);
      if (match?.[1]) {
        maxSequence = Math.max(maxSequence, parseInt(match[1], 10));
      }
    }

    const nextSequence = (maxSequence + 1).toString().padStart(4, '0');

    // Normalize name for filename
    const safeName = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const fileName = `${nextSequence}_${safeName}.sql`;
    const filePath = join(resolvedDir, fileName);

    // Determine template and table name
    const inferredTemplate = template || inferMigrationTemplate(name);
    const inferredTableName = inferTableName(name);

    const context: MigrationTemplateContext = {
      migrationName: name,
      type,
      template: inferredTemplate,
      ...(inferredTableName !== undefined && { tableName: inferredTableName }),
    };

    const content = generateMigrationTemplate(context);

    // Check if file already exists
    if (existsSync(filePath)) {
      return {
        success: false,
        filePath,
        fileName,
        kind: 'migration',
        type,
        error: `File already exists: ${filePath}`,
      };
    }

    // Write file
    await writeFile(filePath, content, 'utf-8');

    return {
      success: true,
      filePath,
      fileName,
      kind: 'migration',
      type,
    };
  } catch (error) {
    return {
      success: false,
      filePath: '',
      fileName: '',
      kind: 'migration',
      type,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get available migration templates
 */
export function getMigrationTemplates(): Array<{
  value: MigrationTemplate;
  label: string;
  description: string;
}> {
  return [
    {
      value: 'create-table',
      label: 'Create Table',
      description: 'Template for creating a new table with common columns',
    },
    {
      value: 'add-column',
      label: 'Add Column',
      description: 'Template for adding columns to an existing table',
    },
    {
      value: 'add-index',
      label: 'Add Index',
      description: 'Template for creating indexes',
    },
    {
      value: 'add-foreign-key',
      label: 'Add Foreign Key',
      description: 'Template for adding foreign key constraints',
    },
    {
      value: 'blank',
      label: 'Blank',
      description: 'Empty migration with basic comments',
    },
  ];
}
