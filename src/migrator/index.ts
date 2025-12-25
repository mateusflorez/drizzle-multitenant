export { Migrator, createMigrator } from './migrator.js';
export { SchemaManager, createSchemaManager } from './schema-manager.js';
export type { CreateSchemaOptions, DropSchemaOptions } from './schema-manager.js';
export { Seeder, createSeeder } from './seed/seeder.js';
export type { SeederConfig, SeederDependencies } from './seed/types.js';
export { SyncManager, createSyncManager } from './sync/sync-manager.js';
export type { SyncManagerConfig, SyncManagerDependencies } from './sync/types.js';
export { MigrationExecutor, createMigrationExecutor, BatchExecutor, createBatchExecutor } from './executor/index.js';
export type {
  MigrationExecutorConfig,
  MigrationExecutorDependencies,
  MigrateTenantOptions,
  BatchExecutorConfig,
  BatchMigrateOptions,
} from './executor/types.js';
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
  // Sync types
  TenantSyncStatus,
  SyncStatus,
  TenantSyncResult,
  SyncResults,
  SyncOptions,
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
