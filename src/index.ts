// Core exports
export { defineConfig } from './config.js';
export { createTenantManager } from './manager.js';
export { createTenantContext } from './context.js';
export { createMigrator, Migrator } from './migrator/migrator.js';
export {
  createCrossSchemaQuery,
  CrossSchemaQueryBuilder,
  withSharedLookup,
  crossSchemaRaw,
  buildCrossSchemaSelect,
} from './cross-schema/cross-schema.js';
export { withShared, WithSharedQueryBuilder } from './cross-schema/with-shared.js';

// Retry utilities
export {
  withRetry,
  createRetrier,
  isRetryableError,
  calculateDelay,
} from './retry.js';

// Types
export type {
  Config,
  ConnectionConfig,
  IsolationConfig,
  IsolationStrategy,
  SchemasConfig,
  Hooks,
  MetricsConfig,
  DebugConfig,
  DebugContext,
  TenantManager,
  TenantDb,
  SharedDb,
  PoolEntry,
  WarmupOptions,
  WarmupResult,
  TenantWarmupResult,
  RetryConfig,
  HealthCheckOptions,
  HealthCheckResult,
  PoolHealth,
  PoolHealthStatus,
  MetricsResult,
  TenantPoolMetrics,
  ConnectionMetrics,
} from './types.js';

export type { RetryResult } from './retry.js';

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
  // Seeding types
  SeedFunction,
  SeedOptions,
  TenantSeedResult,
  SeedResults,
  // Shared schema seeding types
  SharedSeedFunction,
  SharedSeedResult,
} from './migrator/types.js';

export type {
  SchemaSource,
  CrossSchemaContext,
  JoinCondition,
  JoinType,
  TableReference,
  JoinDefinition,
  SharedLookupConfig,
  LookupResult,
  CrossSchemaRawOptions,
  ColumnSelection,
  InferSelectedColumns,
  WithSharedConfig,
  WithSharedOptions,
  InferSelectResult,
} from './cross-schema/types.js';

export { DEFAULT_CONFIG } from './types.js';
