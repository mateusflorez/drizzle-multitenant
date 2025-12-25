import type { Pool } from 'pg';
import type {
  MigrationFile,
  TenantMigrationResult,
  TenantMigrationStatus,
} from '../types.js';
import type { IMigrationExecutor } from '../interfaces.js';
import type {
  MigrationExecutorConfig,
  MigrationExecutorDependencies,
  MigrateTenantOptions,
  AppliedMigration,
  AppliedMigrationRecord,
} from './types.js';
import type { DetectedFormat } from '../table-format.js';

/**
 * Responsible for executing migrations on individual tenants.
 *
 * Extracted from Migrator to follow Single Responsibility Principle.
 * Handles single-tenant migration operations including:
 * - Executing migrations with SQL
 * - Marking migrations as applied (without SQL)
 * - Checking migration status
 * - Getting applied/pending migrations
 *
 * @example
 * ```typescript
 * const executor = new MigrationExecutor(config, dependencies);
 *
 * // Migrate a single tenant
 * const result = await executor.migrateTenant('tenant-123');
 *
 * // Mark migrations as applied without executing SQL
 * const markResult = await executor.markAsApplied('tenant-123');
 *
 * // Get tenant status
 * const status = await executor.getTenantStatus('tenant-123');
 * ```
 */
export class MigrationExecutor implements IMigrationExecutor {
  constructor(
    private readonly config: MigrationExecutorConfig,
    private readonly deps: MigrationExecutorDependencies
  ) {}

  /**
   * Migrate a single tenant
   *
   * Applies all pending migrations to the tenant's schema.
   * Creates the migrations table if it doesn't exist.
   *
   * @param tenantId - The tenant identifier
   * @param migrations - Optional pre-loaded migrations (avoids reloading from disk)
   * @param options - Migration options (dryRun, onProgress)
   * @returns Migration result with applied migrations and duration
   *
   * @example
   * ```typescript
   * const result = await executor.migrateTenant('tenant-123', undefined, {
   *   dryRun: false,
   *   onProgress: (id, status, name) => console.log(`${id}: ${status} ${name}`),
   * });
   *
   * if (result.success) {
   *   console.log(`Applied ${result.appliedMigrations.length} migrations`);
   * }
   * ```
   */
  async migrateTenant(
    tenantId: string,
    migrations?: MigrationFile[],
    options: MigrateTenantOptions = {}
  ): Promise<TenantMigrationResult> {
    const startTime = Date.now();
    const schemaName = this.deps.schemaNameTemplate(tenantId);
    const appliedMigrations: string[] = [];

    const pool = await this.deps.createPool(schemaName);

    try {
      await this.config.hooks?.beforeTenant?.(tenantId);

      // Detect or determine the format before creating table
      const format = await this.deps.getOrDetectFormat(pool, schemaName);

      // Ensure migrations table exists with correct format
      await this.deps.ensureMigrationsTable(pool, schemaName, format);

      // Load migrations if not provided
      const allMigrations = migrations ?? await this.deps.loadMigrations();

      // Get applied migrations using format-aware query
      const applied = await this.getAppliedMigrations(pool, schemaName, format);
      const appliedSet = new Set(applied.map((m) => m.identifier));

      // Filter pending migrations using format-aware comparison
      const pending = allMigrations.filter(
        (m) => !this.isMigrationApplied(m, appliedSet, format)
      );

      if (options.dryRun) {
        return {
          tenantId,
          schemaName,
          success: true,
          appliedMigrations: pending.map((m) => m.name),
          durationMs: Date.now() - startTime,
          format: format.format,
        };
      }

      // Apply pending migrations
      for (const migration of pending) {
        const migrationStart = Date.now();
        options.onProgress?.(tenantId, 'migrating', migration.name);

        await this.config.hooks?.beforeMigration?.(tenantId, migration.name);
        await this.applyMigration(pool, schemaName, migration, format);
        await this.config.hooks?.afterMigration?.(
          tenantId,
          migration.name,
          Date.now() - migrationStart
        );

        appliedMigrations.push(migration.name);
      }

      const result: TenantMigrationResult = {
        tenantId,
        schemaName,
        success: true,
        appliedMigrations,
        durationMs: Date.now() - startTime,
        format: format.format,
      };

      await this.config.hooks?.afterTenant?.(tenantId, result);

      return result;
    } catch (error) {
      const result: TenantMigrationResult = {
        tenantId,
        schemaName,
        success: false,
        appliedMigrations,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };

      await this.config.hooks?.afterTenant?.(tenantId, result);

      return result;
    } finally {
      await pool.end();
    }
  }

  /**
   * Mark migrations as applied without executing SQL
   *
   * Useful for syncing tracking state with already-applied migrations
   * or when migrations were applied manually.
   *
   * @param tenantId - The tenant identifier
   * @param options - Options with progress callback
   * @returns Result with list of marked migrations
   *
   * @example
   * ```typescript
   * const result = await executor.markAsApplied('tenant-123', {
   *   onProgress: (id, status, name) => console.log(`${id}: marking ${name}`),
   * });
   *
   * console.log(`Marked ${result.appliedMigrations.length} migrations`);
   * ```
   */
  async markAsApplied(
    tenantId: string,
    options: { onProgress?: MigrateTenantOptions['onProgress'] } = {}
  ): Promise<TenantMigrationResult> {
    const startTime = Date.now();
    const schemaName = this.deps.schemaNameTemplate(tenantId);
    const markedMigrations: string[] = [];

    const pool = await this.deps.createPool(schemaName);

    try {
      await this.config.hooks?.beforeTenant?.(tenantId);

      // Detect or determine the format before creating table
      const format = await this.deps.getOrDetectFormat(pool, schemaName);

      // Ensure migrations table exists with correct format
      await this.deps.ensureMigrationsTable(pool, schemaName, format);

      // Load all migrations
      const allMigrations = await this.deps.loadMigrations();

      // Get applied migrations
      const applied = await this.getAppliedMigrations(pool, schemaName, format);
      const appliedSet = new Set(applied.map((m) => m.identifier));

      // Filter pending migrations
      const pending = allMigrations.filter(
        (m) => !this.isMigrationApplied(m, appliedSet, format)
      );

      // Mark each pending migration as applied (without executing SQL)
      for (const migration of pending) {
        const migrationStart = Date.now();
        options.onProgress?.(tenantId, 'migrating', migration.name);

        await this.config.hooks?.beforeMigration?.(tenantId, migration.name);
        await this.recordMigration(pool, schemaName, migration, format);
        await this.config.hooks?.afterMigration?.(
          tenantId,
          migration.name,
          Date.now() - migrationStart
        );

        markedMigrations.push(migration.name);
      }

      const result: TenantMigrationResult = {
        tenantId,
        schemaName,
        success: true,
        appliedMigrations: markedMigrations,
        durationMs: Date.now() - startTime,
        format: format.format,
      };

      await this.config.hooks?.afterTenant?.(tenantId, result);

      return result;
    } catch (error) {
      const result: TenantMigrationResult = {
        tenantId,
        schemaName,
        success: false,
        appliedMigrations: markedMigrations,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };

      await this.config.hooks?.afterTenant?.(tenantId, result);

      return result;
    } finally {
      await pool.end();
    }
  }

  /**
   * Get migration status for a specific tenant
   *
   * Returns information about applied and pending migrations.
   *
   * @param tenantId - The tenant identifier
   * @param migrations - Optional pre-loaded migrations
   * @returns Migration status with counts and pending list
   *
   * @example
   * ```typescript
   * const status = await executor.getTenantStatus('tenant-123');
   * if (status.status === 'behind') {
   *   console.log(`Pending: ${status.pendingMigrations.join(', ')}`);
   * }
   * ```
   */
  async getTenantStatus(tenantId: string, migrations?: MigrationFile[]): Promise<TenantMigrationStatus> {
    const schemaName = this.deps.schemaNameTemplate(tenantId);
    const pool = await this.deps.createPool(schemaName);

    try {
      const allMigrations = migrations ?? await this.deps.loadMigrations();

      // Check if migrations table exists
      const tableExists = await this.deps.migrationsTableExists(pool, schemaName);
      if (!tableExists) {
        return {
          tenantId,
          schemaName,
          appliedCount: 0,
          pendingCount: allMigrations.length,
          pendingMigrations: allMigrations.map((m) => m.name),
          status: allMigrations.length > 0 ? 'behind' : 'ok',
          format: null,
        };
      }

      // Detect the table format
      const format = await this.deps.getOrDetectFormat(pool, schemaName);

      const applied = await this.getAppliedMigrations(pool, schemaName, format);
      const appliedSet = new Set(applied.map((m) => m.identifier));

      // Use format-aware comparison
      const pending = allMigrations.filter(
        (m) => !this.isMigrationApplied(m, appliedSet, format)
      );

      return {
        tenantId,
        schemaName,
        appliedCount: applied.length,
        pendingCount: pending.length,
        pendingMigrations: pending.map((m) => m.name),
        status: pending.length > 0 ? 'behind' : 'ok',
        format: format.format,
      };
    } catch (error) {
      return {
        tenantId,
        schemaName,
        appliedCount: 0,
        pendingCount: 0,
        pendingMigrations: [],
        status: 'error',
        error: (error as Error).message,
        format: null,
      };
    } finally {
      await pool.end();
    }
  }

  // ============================================================================
  // IMigrationExecutor Interface Methods
  // ============================================================================

  /**
   * Execute a single migration on a schema
   */
  async executeMigration(
    pool: Pool,
    schemaName: string,
    migration: MigrationFile,
    format: DetectedFormat,
    options?: { markOnly?: boolean; onProgress?: (status: 'applying' | 'recording') => void }
  ): Promise<void> {
    if (options?.markOnly) {
      options.onProgress?.('recording');
      await this.recordMigration(pool, schemaName, migration, format);
    } else {
      options?.onProgress?.('applying');
      await this.applyMigration(pool, schemaName, migration, format);
    }
  }

  /**
   * Execute multiple migrations on a schema
   */
  async executeMigrations(
    pool: Pool,
    schemaName: string,
    migrations: MigrationFile[],
    format: DetectedFormat,
    options?: { markOnly?: boolean; onProgress?: (status: 'applying' | 'recording') => void }
  ): Promise<string[]> {
    const appliedNames: string[] = [];

    for (const migration of migrations) {
      await this.executeMigration(pool, schemaName, migration, format, options);
      appliedNames.push(migration.name);
    }

    return appliedNames;
  }

  /**
   * Record a migration as applied without executing SQL
   */
  async recordMigration(
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
   * Get list of applied migrations for a tenant
   */
  async getAppliedMigrations(
    pool: Pool,
    schemaName: string,
    format: DetectedFormat
  ): Promise<AppliedMigration[]> {
    const identifierColumn = format.columns.identifier;
    const timestampColumn = format.columns.timestamp;

    const result = await pool.query<AppliedMigrationRecord>(
      `SELECT id, "${identifierColumn}" as identifier, "${timestampColumn}" as applied_at
       FROM "${schemaName}"."${format.tableName}"
       ORDER BY id`
    );

    return result.rows.map((row) => {
      // Convert timestamp based on format
      const appliedAt = format.columns.timestampType === 'bigint'
        ? new Date(Number(row.applied_at))
        : new Date(row.applied_at);

      return {
        identifier: row.identifier,
        // Set name or hash based on format
        ...(format.columns.identifier === 'name'
          ? { name: row.identifier }
          : { hash: row.identifier }),
        appliedAt,
      };
    });
  }

  /**
   * Get pending migrations (not yet applied)
   */
  async getPendingMigrations(
    pool: Pool,
    schemaName: string,
    allMigrations: MigrationFile[],
    format: DetectedFormat
  ): Promise<MigrationFile[]> {
    const applied = await this.getAppliedMigrations(pool, schemaName, format);
    const appliedSet = new Set(applied.map((m) => m.identifier));

    return allMigrations.filter(
      (m) => !this.isMigrationApplied(m, appliedSet, format)
    );
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

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
    // This allows migration from name-based to hash-based tracking
    return appliedIdentifiers.has(migration.hash) || appliedIdentifiers.has(migration.name);
  }

  /**
   * Apply a migration to a schema (execute SQL + record)
   */
  private async applyMigration(
    pool: Pool,
    schemaName: string,
    migration: MigrationFile,
    format: DetectedFormat
  ): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Execute migration SQL
      await client.query(migration.sql);

      // Record migration using format-aware insert
      const { identifier, timestamp, timestampType } = format.columns;
      const identifierValue = identifier === 'name' ? migration.name : migration.hash;
      const timestampValue = timestampType === 'bigint' ? Date.now() : new Date();

      await client.query(
        `INSERT INTO "${schemaName}"."${format.tableName}" ("${identifier}", "${timestamp}") VALUES ($1, $2)`,
        [identifierValue, timestampValue]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Factory function to create a MigrationExecutor instance
 *
 * @param config - Executor configuration (hooks)
 * @param dependencies - Required dependencies
 * @returns A configured MigrationExecutor instance
 *
 * @example
 * ```typescript
 * const executor = createMigrationExecutor(
 *   { hooks: { beforeTenant: async (id) => console.log(`Starting ${id}`) } },
 *   {
 *     createPool: schemaManager.createPool.bind(schemaManager),
 *     schemaNameTemplate: (id) => `tenant_${id}`,
 *     migrationsTableExists: schemaManager.migrationsTableExists.bind(schemaManager),
 *     ensureMigrationsTable: schemaManager.ensureMigrationsTable.bind(schemaManager),
 *     getOrDetectFormat: async (pool, schema) => getFormatConfig('name', table),
 *     loadMigrations: async () => loadMigrationsFromDisk(),
 *   }
 * );
 * ```
 */
export function createMigrationExecutor(
  config: MigrationExecutorConfig,
  dependencies: MigrationExecutorDependencies
): MigrationExecutor {
  return new MigrationExecutor(config, dependencies);
}
