// Core exports
export { defineConfig } from './config.js';
export { createTenantManager } from './manager.js';
export { createTenantContext } from './context.js';
export { createMigrator, Migrator } from './migrator/migrator.js';

// Types
export type {
  Config,
  ConnectionConfig,
  IsolationConfig,
  IsolationStrategy,
  SchemasConfig,
  Hooks,
  MetricsConfig,
  TenantManager,
  TenantDb,
  SharedDb,
  PoolEntry,
} from './types.js';

export type {
  TenantContext,
  TenantContextData,
  BaseTenantContext,
} from './context.js';

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
} from './migrator/types.js';

export { DEFAULT_CONFIG } from './types.js';
