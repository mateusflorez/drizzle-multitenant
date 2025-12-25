/**
 * Migration Executor Module
 *
 * Extracted from the Migrator god component to follow Single Responsibility Principle.
 * This module handles all migration execution operations.
 *
 * @module migrator/executor
 *
 * @example
 * ```typescript
 * import { MigrationExecutor, BatchExecutor } from 'drizzle-multitenant/migrator/executor';
 *
 * // Single tenant execution
 * const executor = new MigrationExecutor(config, dependencies);
 * const result = await executor.migrateTenant('tenant-123');
 *
 * // Batch execution
 * const batchExecutor = new BatchExecutor(batchConfig, executor, loadMigrations);
 * const results = await batchExecutor.migrateAll({ concurrency: 10 });
 * ```
 */

export { MigrationExecutor, createMigrationExecutor } from './migration-executor.js';
export { BatchExecutor, createBatchExecutor } from './batch-executor.js';
export type {
  MigrationExecutorConfig,
  MigrationExecutorDependencies,
  MigrateTenantOptions,
  BatchExecutorConfig,
  BatchMigrateOptions,
  AppliedMigration,
  AppliedMigrationRecord,
} from './types.js';
