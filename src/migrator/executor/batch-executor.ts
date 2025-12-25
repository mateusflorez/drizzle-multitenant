import type {
  MigrationFile,
  TenantMigrationResult,
  MigrationResults,
  TenantMigrationStatus,
} from '../types.js';
import type { IBatchExecutor } from '../interfaces.js';
import type { MigrationExecutor } from './migration-executor.js';
import type { BatchExecutorConfig, BatchMigrateOptions } from './types.js';

/**
 * Responsible for batch migration operations across multiple tenants.
 *
 * Extracted from Migrator to follow Single Responsibility Principle.
 * Handles parallel migration operations including:
 * - Migrating all tenants with configurable concurrency
 * - Migrating specific tenants
 * - Marking all migrations as applied
 * - Progress tracking and error handling
 *
 * @example
 * ```typescript
 * const batchExecutor = new BatchExecutor(config, migrationExecutor, loadMigrations);
 *
 * // Migrate all tenants with concurrency 10
 * const results = await batchExecutor.migrateAll({ concurrency: 10 });
 *
 * // Migrate specific tenants
 * const specificResults = await batchExecutor.migrateTenants(['t1', 't2'], {
 *   onProgress: (id, status) => console.log(`${id}: ${status}`),
 * });
 * ```
 */
export class BatchExecutor implements IBatchExecutor {
  constructor(
    private readonly config: BatchExecutorConfig,
    private readonly executor: MigrationExecutor,
    private readonly loadMigrations: () => Promise<MigrationFile[]>
  ) {}

  /**
   * Migrate all tenants in parallel
   *
   * Processes tenants in batches with configurable concurrency.
   * Supports progress callbacks, error handling, and abort behavior.
   *
   * @param options - Migration options (concurrency, dryRun, callbacks)
   * @returns Aggregate results for all tenants
   *
   * @example
   * ```typescript
   * const results = await batchExecutor.migrateAll({
   *   concurrency: 10,
   *   dryRun: false,
   *   onProgress: (id, status) => console.log(`${id}: ${status}`),
   *   onError: (id, error) => {
   *     console.error(`${id} failed: ${error.message}`);
   *     return 'continue'; // or 'abort' to stop all
   *   },
   * });
   *
   * console.log(`Succeeded: ${results.succeeded}/${results.total}`);
   * ```
   */
  async migrateAll(options: BatchMigrateOptions = {}): Promise<MigrationResults> {
    const {
      concurrency = 10,
      onProgress,
      onError,
      dryRun = false,
    } = options;

    const tenantIds = await this.config.tenantDiscovery();
    const migrations = await this.loadMigrations();

    const results: TenantMigrationResult[] = [];
    let aborted = false;

    // Process tenants in batches
    for (let i = 0; i < tenantIds.length && !aborted; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          if (aborted) {
            return this.createSkippedResult(tenantId);
          }

          try {
            onProgress?.(tenantId, 'starting');
            const result = await this.executor.migrateTenant(tenantId, migrations, { dryRun, onProgress });
            onProgress?.(tenantId, result.success ? 'completed' : 'failed');
            return result;
          } catch (error) {
            onProgress?.(tenantId, 'failed');
            const action = onError?.(tenantId, error as Error);
            if (action === 'abort') {
              aborted = true;
            }
            return this.createErrorResult(tenantId, error as Error);
          }
        })
      );

      results.push(...batchResults);
    }

    // Mark remaining tenants as skipped if aborted
    if (aborted) {
      const remaining = tenantIds.slice(results.length);
      for (const tenantId of remaining) {
        results.push(this.createSkippedResult(tenantId));
      }
    }

    return this.aggregateResults(results);
  }

  /**
   * Migrate specific tenants in parallel
   *
   * Same as migrateAll but for a subset of tenants.
   *
   * @param tenantIds - List of tenant IDs to migrate
   * @param options - Migration options
   * @returns Aggregate results for specified tenants
   *
   * @example
   * ```typescript
   * const results = await batchExecutor.migrateTenants(
   *   ['tenant-1', 'tenant-2', 'tenant-3'],
   *   { concurrency: 5 }
   * );
   * ```
   */
  async migrateTenants(tenantIds: string[], options: BatchMigrateOptions = {}): Promise<MigrationResults> {
    const migrations = await this.loadMigrations();
    const results: TenantMigrationResult[] = [];

    const { concurrency = 10, onProgress, onError, dryRun = false } = options;

    for (let i = 0; i < tenantIds.length; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          try {
            onProgress?.(tenantId, 'starting');
            const result = await this.executor.migrateTenant(tenantId, migrations, { dryRun, onProgress });
            onProgress?.(tenantId, result.success ? 'completed' : 'failed');
            return result;
          } catch (error) {
            onProgress?.(tenantId, 'failed');
            onError?.(tenantId, error as Error);
            return this.createErrorResult(tenantId, error as Error);
          }
        })
      );

      results.push(...batchResults);
    }

    return this.aggregateResults(results);
  }

  /**
   * Mark all tenants as applied without executing SQL
   *
   * Useful for syncing tracking state with already-applied migrations.
   * Processes tenants in parallel with configurable concurrency.
   *
   * @param options - Migration options
   * @returns Aggregate results for all tenants
   *
   * @example
   * ```typescript
   * const results = await batchExecutor.markAllAsApplied({
   *   concurrency: 10,
   *   onProgress: (id, status) => console.log(`${id}: ${status}`),
   * });
   * ```
   */
  async markAllAsApplied(options: BatchMigrateOptions = {}): Promise<MigrationResults> {
    const {
      concurrency = 10,
      onProgress,
      onError,
    } = options;

    const tenantIds = await this.config.tenantDiscovery();
    const results: TenantMigrationResult[] = [];
    let aborted = false;

    // Process tenants in batches
    for (let i = 0; i < tenantIds.length && !aborted; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          if (aborted) {
            return this.createSkippedResult(tenantId);
          }

          try {
            onProgress?.(tenantId, 'starting');
            const result = await this.executor.markAsApplied(tenantId, { onProgress });
            onProgress?.(tenantId, result.success ? 'completed' : 'failed');
            return result;
          } catch (error) {
            onProgress?.(tenantId, 'failed');
            const action = onError?.(tenantId, error as Error);
            if (action === 'abort') {
              aborted = true;
            }
            return this.createErrorResult(tenantId, error as Error);
          }
        })
      );

      results.push(...batchResults);
    }

    // Mark remaining tenants as skipped if aborted
    if (aborted) {
      const remaining = tenantIds.slice(results.length);
      for (const tenantId of remaining) {
        results.push(this.createSkippedResult(tenantId));
      }
    }

    return this.aggregateResults(results);
  }

  /**
   * Get migration status for all tenants
   *
   * Queries each tenant's migration status sequentially.
   *
   * @returns List of migration status for all tenants
   *
   * @example
   * ```typescript
   * const statuses = await batchExecutor.getStatus();
   * const behind = statuses.filter(s => s.status === 'behind');
   * console.log(`${behind.length} tenants need migrations`);
   * ```
   */
  async getStatus(): Promise<TenantMigrationStatus[]> {
    const tenantIds = await this.config.tenantDiscovery();
    const migrations = await this.loadMigrations();
    const statuses: TenantMigrationStatus[] = [];

    for (const tenantId of tenantIds) {
      statuses.push(await this.executor.getTenantStatus(tenantId, migrations));
    }

    return statuses;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Create a skipped result for aborted operations
   */
  private createSkippedResult(tenantId: string): TenantMigrationResult {
    return {
      tenantId,
      schemaName: '', // Schema name not available in batch context
      success: false,
      appliedMigrations: [],
      error: 'Skipped due to abort',
      durationMs: 0,
    };
  }

  /**
   * Create an error result for failed operations
   */
  private createErrorResult(tenantId: string, error: Error): TenantMigrationResult {
    return {
      tenantId,
      schemaName: '', // Schema name not available in batch context
      success: false,
      appliedMigrations: [],
      error: error.message,
      durationMs: 0,
    };
  }

  /**
   * Aggregate individual migration results into a summary
   */
  private aggregateResults(results: TenantMigrationResult[]): MigrationResults {
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success && r.error !== 'Skipped due to abort').length,
      skipped: results.filter((r) => r.error === 'Skipped due to abort').length,
      details: results,
    };
  }
}

/**
 * Factory function to create a BatchExecutor instance
 *
 * @param config - Batch configuration (tenantDiscovery)
 * @param executor - MigrationExecutor instance
 * @param loadMigrations - Function to load migrations from disk
 * @returns A configured BatchExecutor instance
 *
 * @example
 * ```typescript
 * const batchExecutor = createBatchExecutor(
 *   { tenantDiscovery: async () => ['t1', 't2', 't3'] },
 *   migrationExecutor,
 *   async () => loadMigrationsFromDisk('./migrations')
 * );
 * ```
 */
export function createBatchExecutor(
  config: BatchExecutorConfig,
  executor: MigrationExecutor,
  loadMigrations: () => Promise<MigrationFile[]>
): BatchExecutor {
  return new BatchExecutor(config, executor, loadMigrations);
}
