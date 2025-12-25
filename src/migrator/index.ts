export { Migrator, createMigrator } from './migrator.js';
export { SchemaManager, createSchemaManager } from './schema-manager.js';
export type { CreateSchemaOptions, DropSchemaOptions } from './schema-manager.js';
export { detectTableFormat, getFormatConfig, DEFAULT_FORMAT, DRIZZLE_KIT_FORMAT } from './table-format.js';
export type { TableFormat, DetectedFormat } from './table-format.js';
export type {
  MigratorConfig,
  MigrationFile,
  MigrateOptions,
  TenantMigrationResult,
  MigrationResults,
  TenantMigrationStatus,
  MigrationHooks,
  MigrationProgressCallback,
  MigrationErrorHandler,
  CreateTenantOptions,
  DropTenantOptions,
  AppliedMigration,
  // Seeding types
  SeedFunction,
  SeedOptions,
  TenantSeedResult,
  SeedResults,
  // Schema drift detection types
  ColumnInfo,
  IndexInfo,
  ConstraintInfo,
  TableSchema,
  TenantSchema,
  ColumnDrift,
  IndexDrift,
  ConstraintDrift,
  TableDrift,
  TenantSchemaDrift,
  SchemaDriftStatus,
  SchemaDriftOptions,
} from './types.js';
