/**
 * Scaffold module types
 *
 * @module scaffold/types
 */

/**
 * Type of scaffold to generate
 */
export type ScaffoldType = 'tenant' | 'shared';

/**
 * Kind of scaffold template
 */
export type ScaffoldKind = 'schema' | 'seed' | 'migration';

/**
 * Options for scaffolding a schema
 */
export interface ScaffoldSchemaOptions {
  /** Name of the schema/table (e.g., "orders", "products") */
  name: string;
  /** Type of schema (tenant or shared) */
  type: ScaffoldType;
  /** Output directory for the schema file */
  outputDir?: string;
  /** Whether to include example columns */
  includeExample?: boolean;
  /** Whether to include timestamps (createdAt, updatedAt) */
  includeTimestamps?: boolean;
  /** Whether to include soft delete (deletedAt) */
  includeSoftDelete?: boolean;
  /** Whether to use UUID for primary key (default: true) */
  useUuid?: boolean;
}

/**
 * Options for scaffolding a seed
 */
export interface ScaffoldSeedOptions {
  /** Name of the seed file (e.g., "initial", "demo-data") */
  name: string;
  /** Type of seed (tenant or shared) */
  type: ScaffoldType;
  /** Output directory for the seed file */
  outputDir?: string;
  /** Optional table name to seed */
  tableName?: string;
}

/**
 * Options for scaffolding a migration
 */
export interface ScaffoldMigrationOptions {
  /** Name of the migration (e.g., "add-orders", "create-users") */
  name: string;
  /** Type of migration (tenant or shared) */
  type: ScaffoldType;
  /** Output directory for the migration file */
  outputDir?: string;
  /** Migration template type */
  template?: MigrationTemplate;
}

/**
 * Available migration templates
 */
export type MigrationTemplate =
  | 'create-table'
  | 'add-column'
  | 'add-index'
  | 'add-foreign-key'
  | 'blank';

/**
 * Result of a scaffold operation
 */
export interface ScaffoldResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Path to the generated file */
  filePath: string;
  /** Name of the generated file */
  fileName: string;
  /** Type of scaffold generated */
  kind: ScaffoldKind;
  /** Tenant or shared */
  type: ScaffoldType;
  /** Optional error message if failed */
  error?: string;
}

/**
 * Template context for schema generation
 */
export interface SchemaTemplateContext {
  /** Table name in snake_case */
  tableName: string;
  /** Table name in PascalCase */
  tableNamePascal: string;
  /** Table name in camelCase */
  tableNameCamel: string;
  /** Schema type (tenant or shared) */
  type: ScaffoldType;
  /** Whether to include timestamps */
  includeTimestamps: boolean;
  /** Whether to include soft delete */
  includeSoftDelete: boolean;
  /** Whether to use UUID for primary key */
  useUuid: boolean;
  /** Whether to include example columns */
  includeExample: boolean;
}

/**
 * Template context for seed generation
 */
export interface SeedTemplateContext {
  /** Seed function name in camelCase */
  seedName: string;
  /** Table name (optional) */
  tableName?: string;
  /** Schema type (tenant or shared) */
  type: ScaffoldType;
}

/**
 * Template context for migration generation
 */
export interface MigrationTemplateContext {
  /** Migration name for comments */
  migrationName: string;
  /** Schema type (tenant or shared) */
  type: ScaffoldType;
  /** Template type */
  template: MigrationTemplate;
  /** Table name (derived from migration name) */
  tableName?: string;
}

/**
 * Generated file output
 */
export interface GeneratedFile {
  /** File path relative to project root */
  path: string;
  /** File content */
  content: string;
}

/**
 * Scaffold configuration from tenant.config.ts
 */
export interface ScaffoldConfig {
  /** Schema output directory */
  schemaDir?: string;
  /** Seed output directory */
  seedDir?: string;
  /** Migrations folder */
  migrationsFolder?: string;
  /** Shared migrations folder */
  sharedMigrationsFolder?: string;
}
