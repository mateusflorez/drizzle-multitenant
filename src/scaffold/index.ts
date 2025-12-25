/**
 * Scaffold module
 *
 * Provides utilities for scaffolding new schemas, seeds, and migrations.
 *
 * @module scaffold
 *
 * @example
 * ```typescript
 * import { scaffoldSchema, scaffoldSeed, scaffoldMigration } from 'drizzle-multitenant/scaffold';
 *
 * // Scaffold a new tenant schema
 * const schemaResult = await scaffoldSchema({
 *   name: 'orders',
 *   type: 'tenant',
 *   includeTimestamps: true,
 * });
 *
 * // Scaffold a new seed file
 * const seedResult = await scaffoldSeed({
 *   name: 'initial',
 *   type: 'tenant',
 * });
 *
 * // Scaffold a new migration
 * const migrationResult = await scaffoldMigration({
 *   name: 'add-orders',
 *   type: 'tenant',
 *   template: 'create-table',
 * });
 * ```
 */

// Types
export type {
  ScaffoldType,
  ScaffoldKind,
  ScaffoldSchemaOptions,
  ScaffoldSeedOptions,
  ScaffoldMigrationOptions,
  MigrationTemplate,
  ScaffoldResult,
  SchemaTemplateContext,
  SeedTemplateContext,
  MigrationTemplateContext,
  GeneratedFile,
  ScaffoldConfig,
} from './types.js';

// Generator functions
export {
  scaffoldSchema,
  scaffoldSeed,
  scaffoldMigration,
  toCase,
  getMigrationTemplates,
  DEFAULT_DIRS,
} from './generator.js';

// Templates
export { generateSchemaTemplate } from './templates/schema-template.js';
export { generateSeedTemplate } from './templates/seed-template.js';
export {
  generateMigrationTemplate,
  inferMigrationTemplate,
  inferTableName,
} from './templates/migration-template.js';
