import type { Pool } from 'pg';
import type {
  MigrationFile,
  TenantSyncStatus,
  SyncStatus,
  TenantSyncResult,
  SyncResults,
  SyncOptions,
} from '../types.js';
import type { ISyncManager } from '../interfaces.js';
import type { SyncManagerConfig, SyncManagerDependencies, AppliedMigrationRecord } from './types.js';
import type { DetectedFormat } from '../table-format.js';

/**
 * Responsible for synchronizing migration state between disk and database.
 *
 * Extracted from Migrator to follow Single Responsibility Principle.
 * Handles detection of divergences and reconciliation operations.
 *
 * @example
 * ```typescript
 * const syncManager = new SyncManager(config, dependencies);
 *
 * // Check sync status
 * const status = await syncManager.getSyncStatus();
 * if (status.outOfSync > 0) {
 *   console.log(`${status.outOfSync} tenants out of sync`);
 * }
 *
 * // Mark missing migrations as applied
 * await syncManager.markAllMissing({ concurrency: 10 });
 *
 * // Clean orphan records
 * await syncManager.cleanAllOrphans({ concurrency: 10 });
 * ```
 */
export class SyncManager implements ISyncManager {
  constructor(
    private readonly config: SyncManagerConfig,
    private readonly deps: SyncManagerDependencies
  ) {}

  /**
   * Get sync status for all tenants
   *
   * Detects divergences between migrations on disk and tracking in database.
   * A tenant is "in sync" when all disk migrations are tracked and no orphan records exist.
   *
   * @returns Aggregate sync status for all tenants
   *
   * @example
   * ```typescript
   * const status = await syncManager.getSyncStatus();
   * console.log(`Total: ${status.total}, In sync: ${status.inSync}, Out of sync: ${status.outOfSync}`);
   *
   * for (const tenant of status.details.filter(d => !d.inSync)) {
   *   console.log(`${tenant.tenantId}: missing=${tenant.missing.length}, orphans=${tenant.orphans.length}`);
   * }
   * ```
   */
  async getSyncStatus(): Promise<SyncStatus> {
    const tenantIds = await this.config.tenantDiscovery();
    const migrations = await this.deps.loadMigrations();
    const statuses: TenantSyncStatus[] = [];

    for (const tenantId of tenantIds) {
      statuses.push(await this.getTenantSyncStatus(tenantId, migrations));
    }

    return {
      total: statuses.length,
      inSync: statuses.filter((s) => s.inSync && !s.error).length,
      outOfSync: statuses.filter((s) => !s.inSync && !s.error).length,
      error: statuses.filter((s) => !!s.error).length,
      details: statuses,
    };
  }

  /**
   * Get sync status for a specific tenant
   *
   * Compares migrations on disk with records in the database.
   * Identifies missing migrations (on disk but not tracked) and
   * orphan records (tracked but not on disk).
   *
   * @param tenantId - The tenant identifier
   * @param migrations - Optional pre-loaded migrations (avoids reloading from disk)
   * @returns Sync status for the tenant
   *
   * @example
   * ```typescript
   * const status = await syncManager.getTenantSyncStatus('tenant-123');
   * if (status.missing.length > 0) {
   *   console.log(`Missing: ${status.missing.join(', ')}`);
   * }
   * if (status.orphans.length > 0) {
   *   console.log(`Orphans: ${status.orphans.join(', ')}`);
   * }
   * ```
   */
  async getTenantSyncStatus(tenantId: string, migrations?: MigrationFile[]): Promise<TenantSyncStatus> {
    const schemaName = this.deps.schemaNameTemplate(tenantId);
    const pool = await this.deps.createPool(schemaName);

    try {
      const allMigrations = migrations ?? await this.deps.loadMigrations();
      const migrationNames = new Set(allMigrations.map((m) => m.name));
      const migrationHashes = new Set(allMigrations.map((m) => m.hash));

      // Check if migrations table exists
      const tableExists = await this.deps.migrationsTableExists(pool, schemaName);
      if (!tableExists) {
        return {
          tenantId,
          schemaName,
          missing: allMigrations.map((m) => m.name),
          orphans: [],
          inSync: allMigrations.length === 0,
          format: null,
        };
      }

      // Detect the table format
      const format = await this.deps.getOrDetectFormat(pool, schemaName);
      const applied = await this.getAppliedMigrations(pool, schemaName, format);

      // Find missing migrations (in disk but not in database)
      const appliedIdentifiers = new Set(applied.map((m) => m.identifier));
      const missing = allMigrations
        .filter((m) => !this.isMigrationApplied(m, appliedIdentifiers, format))
        .map((m) => m.name);

      // Find orphan records (in database but not in disk)
      const orphans = applied
        .filter((m) => {
          if (format.columns.identifier === 'name') {
            return !migrationNames.has(m.identifier);
          }
          // For hash-based formats, check both hash and name
          return !migrationHashes.has(m.identifier) && !migrationNames.has(m.identifier);
        })
        .map((m) => m.identifier);

      return {
        tenantId,
        schemaName,
        missing,
        orphans,
        inSync: missing.length === 0 && orphans.length === 0,
        format: format.format,
      };
    } catch (error) {
      return {
        tenantId,
        schemaName,
        missing: [],
        orphans: [],
        inSync: false,
        format: null,
        error: (error as Error).message,
      };
    } finally {
      await pool.end();
    }
  }

  /**
   * Mark missing migrations as applied for a tenant
   *
   * Records migrations that exist on disk but are not tracked in the database.
   * Useful for syncing tracking state with already-applied migrations.
   *
   * @param tenantId - The tenant identifier
   * @returns Result of the mark operation
   *
   * @example
   * ```typescript
   * const result = await syncManager.markMissing('tenant-123');
   * if (result.success) {
   *   console.log(`Marked ${result.markedMigrations.length} migrations as applied`);
   * }
   * ```
   */
  async markMissing(tenantId: string): Promise<TenantSyncResult> {
    const startTime = Date.now();
    const schemaName = this.deps.schemaNameTemplate(tenantId);
    const markedMigrations: string[] = [];

    const pool = await this.deps.createPool(schemaName);

    try {
      const syncStatus = await this.getTenantSyncStatus(tenantId);

      if (syncStatus.error) {
        return {
          tenantId,
          schemaName,
          success: false,
          markedMigrations: [],
          removedOrphans: [],
          error: syncStatus.error,
          durationMs: Date.now() - startTime,
        };
      }

      if (syncStatus.missing.length === 0) {
        return {
          tenantId,
          schemaName,
          success: true,
          markedMigrations: [],
          removedOrphans: [],
          durationMs: Date.now() - startTime,
        };
      }

      const format = await this.deps.getOrDetectFormat(pool, schemaName);
      await this.deps.ensureMigrationsTable(pool, schemaName, format);

      const allMigrations = await this.deps.loadMigrations();
      const missingSet = new Set(syncStatus.missing);

      for (const migration of allMigrations) {
        if (missingSet.has(migration.name)) {
          await this.recordMigration(pool, schemaName, migration, format);
          markedMigrations.push(migration.name);
        }
      }

      return {
        tenantId,
        schemaName,
        success: true,
        markedMigrations,
        removedOrphans: [],
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        tenantId,
        schemaName,
        success: false,
        markedMigrations,
        removedOrphans: [],
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    } finally {
      await pool.end();
    }
  }

  /**
   * Mark missing migrations as applied for all tenants
   *
   * Processes all tenants in parallel with configurable concurrency.
   * Supports progress callbacks and abort-on-error behavior.
   *
   * @param options - Sync options
   * @returns Aggregate results of all mark operations
   *
   * @example
   * ```typescript
   * const results = await syncManager.markAllMissing({
   *   concurrency: 10,
   *   onProgress: (id, status) => console.log(`${id}: ${status}`),
   * });
   * console.log(`Succeeded: ${results.succeeded}/${results.total}`);
   * ```
   */
  async markAllMissing(options: SyncOptions = {}): Promise<SyncResults> {
    const { concurrency = 10, onProgress, onError } = options;

    const tenantIds = await this.config.tenantDiscovery();
    const results: TenantSyncResult[] = [];
    let aborted = false;

    for (let i = 0; i < tenantIds.length && !aborted; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          if (aborted) {
            return this.createSkippedSyncResult(tenantId);
          }

          try {
            onProgress?.(tenantId, 'starting');
            const result = await this.markMissing(tenantId);
            onProgress?.(tenantId, result.success ? 'completed' : 'failed');
            return result;
          } catch (error) {
            onProgress?.(tenantId, 'failed');
            const action = onError?.(tenantId, error as Error);
            if (action === 'abort') {
              aborted = true;
            }
            return this.createErrorSyncResult(tenantId, error as Error);
          }
        })
      );

      results.push(...batchResults);
    }

    return this.aggregateSyncResults(results);
  }

  /**
   * Remove orphan migration records for a tenant
   *
   * Deletes records from the migrations table that don't have
   * corresponding files on disk.
   *
   * @param tenantId - The tenant identifier
   * @returns Result of the clean operation
   *
   * @example
   * ```typescript
   * const result = await syncManager.cleanOrphans('tenant-123');
   * if (result.success) {
   *   console.log(`Removed ${result.removedOrphans.length} orphan records`);
   * }
   * ```
   */
  async cleanOrphans(tenantId: string): Promise<TenantSyncResult> {
    const startTime = Date.now();
    const schemaName = this.deps.schemaNameTemplate(tenantId);
    const removedOrphans: string[] = [];

    const pool = await this.deps.createPool(schemaName);

    try {
      const syncStatus = await this.getTenantSyncStatus(tenantId);

      if (syncStatus.error) {
        return {
          tenantId,
          schemaName,
          success: false,
          markedMigrations: [],
          removedOrphans: [],
          error: syncStatus.error,
          durationMs: Date.now() - startTime,
        };
      }

      if (syncStatus.orphans.length === 0) {
        return {
          tenantId,
          schemaName,
          success: true,
          markedMigrations: [],
          removedOrphans: [],
          durationMs: Date.now() - startTime,
        };
      }

      const format = await this.deps.getOrDetectFormat(pool, schemaName);
      const identifierColumn = format.columns.identifier;

      for (const orphan of syncStatus.orphans) {
        await pool.query(
          `DELETE FROM "${schemaName}"."${format.tableName}" WHERE "${identifierColumn}" = $1`,
          [orphan]
        );
        removedOrphans.push(orphan);
      }

      return {
        tenantId,
        schemaName,
        success: true,
        markedMigrations: [],
        removedOrphans,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        tenantId,
        schemaName,
        success: false,
        markedMigrations: [],
        removedOrphans,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    } finally {
      await pool.end();
    }
  }

  /**
   * Remove orphan migration records for all tenants
   *
   * Processes all tenants in parallel with configurable concurrency.
   * Supports progress callbacks and abort-on-error behavior.
   *
   * @param options - Sync options
   * @returns Aggregate results of all clean operations
   *
   * @example
   * ```typescript
   * const results = await syncManager.cleanAllOrphans({
   *   concurrency: 10,
   *   onProgress: (id, status) => console.log(`${id}: ${status}`),
   * });
   * console.log(`Succeeded: ${results.succeeded}/${results.total}`);
   * ```
   */
  async cleanAllOrphans(options: SyncOptions = {}): Promise<SyncResults> {
    const { concurrency = 10, onProgress, onError } = options;

    const tenantIds = await this.config.tenantDiscovery();
    const results: TenantSyncResult[] = [];
    let aborted = false;

    for (let i = 0; i < tenantIds.length && !aborted; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          if (aborted) {
            return this.createSkippedSyncResult(tenantId);
          }

          try {
            onProgress?.(tenantId, 'starting');
            const result = await this.cleanOrphans(tenantId);
            onProgress?.(tenantId, result.success ? 'completed' : 'failed');
            return result;
          } catch (error) {
            onProgress?.(tenantId, 'failed');
            const action = onError?.(tenantId, error as Error);
            if (action === 'abort') {
              aborted = true;
            }
            return this.createErrorSyncResult(tenantId, error as Error);
          }
        })
      );

      results.push(...batchResults);
    }

    return this.aggregateSyncResults(results);
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Get applied migrations for a schema
   */
  private async getAppliedMigrations(
    pool: Pool,
    schemaName: string,
    format: DetectedFormat
  ): Promise<Array<{ identifier: string; appliedAt: Date }>> {
    const identifierColumn = format.columns.identifier;
    const timestampColumn = format.columns.timestamp;

    const result = await pool.query<AppliedMigrationRecord>(
      `SELECT id, "${identifierColumn}" as identifier, "${timestampColumn}" as applied_at
       FROM "${schemaName}"."${format.tableName}"
       ORDER BY id`
    );

    return result.rows.map((row) => {
      const appliedAt = format.columns.timestampType === 'bigint'
        ? new Date(Number(row.applied_at))
        : new Date(row.applied_at);

      return {
        identifier: row.identifier,
        appliedAt,
      };
    });
  }

  /**
   * Check if a migration has been applied
   */
  private isMigrationApplied(
    migration: MigrationFile,
    appliedIdentifiers: Set<string>,
    format: DetectedFormat
  ): boolean {
    if (format.columns.identifier === 'name') {
      return appliedIdentifiers.has(migration.name);
    }

    // Hash-based: check both hash AND name for backwards compatibility
    return appliedIdentifiers.has(migration.hash) || appliedIdentifiers.has(migration.name);
  }

  /**
   * Record a migration as applied (without executing SQL)
   */
  private async recordMigration(
    pool: Pool,
    schemaName: string,
    migration: MigrationFile,
    format: DetectedFormat
  ): Promise<void> {
    const { identifier, timestamp, timestampType } = format.columns;
    const identifierValue = identifier === 'name' ? migration.name : migration.hash;
    const timestampValue = timestampType === 'bigint' ? Date.now() : new Date();

    await pool.query(
      `INSERT INTO "${schemaName}"."${format.tableName}" ("${identifier}", "${timestamp}") VALUES ($1, $2)`,
      [identifierValue, timestampValue]
    );
  }

  /**
   * Create a skipped sync result for aborted operations
   */
  private createSkippedSyncResult(tenantId: string): TenantSyncResult {
    return {
      tenantId,
      schemaName: this.deps.schemaNameTemplate(tenantId),
      success: false,
      markedMigrations: [],
      removedOrphans: [],
      error: 'Skipped due to abort',
      durationMs: 0,
    };
  }

  /**
   * Create an error sync result for failed operations
   */
  private createErrorSyncResult(tenantId: string, error: Error): TenantSyncResult {
    return {
      tenantId,
      schemaName: this.deps.schemaNameTemplate(tenantId),
      success: false,
      markedMigrations: [],
      removedOrphans: [],
      error: error.message,
      durationMs: 0,
    };
  }

  /**
   * Aggregate individual sync results into a summary
   */
  private aggregateSyncResults(results: TenantSyncResult[]): SyncResults {
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      details: results,
    };
  }
}

/**
 * Factory function to create a SyncManager instance
 *
 * @param config - SyncManager configuration
 * @param dependencies - Required dependencies
 * @returns A configured SyncManager instance
 *
 * @example
 * ```typescript
 * const syncManager = createSyncManager(
 *   {
 *     tenantDiscovery: async () => ['t1', 't2'],
 *     migrationsFolder: './migrations',
 *     migrationsTable: '__drizzle_migrations',
 *   },
 *   {
 *     createPool: schemaManager.createPool.bind(schemaManager),
 *     schemaNameTemplate: (id) => `tenant_${id}`,
 *     migrationsTableExists: schemaManager.migrationsTableExists.bind(schemaManager),
 *     ensureMigrationsTable: schemaManager.ensureMigrationsTable.bind(schemaManager),
 *     getOrDetectFormat: migrator.getOrDetectFormat.bind(migrator),
 *     loadMigrations: migrator.loadMigrations.bind(migrator),
 *   }
 * );
 * ```
 */
export function createSyncManager(
  config: SyncManagerConfig,
  dependencies: SyncManagerDependencies
): SyncManager {
  return new SyncManager(config, dependencies);
}
