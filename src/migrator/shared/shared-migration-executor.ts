import type { Pool } from 'pg';
import type {
  MigrationFile,
  SharedMigrationResult,
  SharedMigrationStatus,
  SharedMigrateOptions,
} from '../types.js';
import type { DetectedFormat } from '../table-format.js';
import type {
  SharedMigrationExecutorConfig,
  SharedMigrationExecutorDependencies,
  AppliedMigration,
  AppliedMigrationRecord,
} from './types.js';

const DEFAULT_SHARED_SCHEMA = 'public';

/**
 * Executor for shared schema migrations
 *
 * Handles migrations for the shared/public schema, separate from tenant schemas.
 * Used for tables that are shared across all tenants (e.g., plans, roles, permissions).
 *
 * @example
 * ```typescript
 * const executor = new SharedMigrationExecutor(config, dependencies);
 *
 * // Get status
 * const status = await executor.getStatus();
 * console.log(`Pending: ${status.pendingCount}`);
 *
 * // Apply migrations
 * const result = await executor.migrate();
 * console.log(`Applied: ${result.appliedMigrations.length}`);
 * ```
 */
export class SharedMigrationExecutor {
  private readonly schemaName: string;

  constructor(
    private readonly config: SharedMigrationExecutorConfig,
    private readonly deps: SharedMigrationExecutorDependencies
  ) {
    this.schemaName = config.schemaName ?? DEFAULT_SHARED_SCHEMA;
  }

  /**
   * Apply pending migrations to the shared schema
   *
   * @param options - Migration options (dryRun, onProgress)
   * @returns Migration result with applied migrations
   *
   * @example
   * ```typescript
   * const result = await executor.migrate({
   *   dryRun: false,
   *   onProgress: (status, name) => console.log(`${status}: ${name}`),
   * });
   *
   * if (result.success) {
   *   console.log(`Applied ${result.appliedMigrations.length} migrations`);
   * }
   * ```
   */
  async migrate(options: SharedMigrateOptions = {}): Promise<SharedMigrationResult> {
    const startTime = Date.now();
    const appliedMigrations: string[] = [];

    const pool = await this.deps.createPool();

    try {
      options.onProgress?.('starting');
      await this.config.hooks?.beforeMigration?.();

      // Detect or determine the format
      const format = await this.deps.getOrDetectFormat(pool, this.schemaName);

      // Ensure migrations table exists
      await this.deps.ensureMigrationsTable(pool, this.schemaName, format);

      // Load all migrations
      const allMigrations = await this.deps.loadMigrations();

      // Get applied migrations
      const applied = await this.getAppliedMigrations(pool, format);
      const appliedSet = new Set(applied.map((m) => m.identifier));

      // Filter pending migrations
      const pending = allMigrations.filter(
        (m) => !this.isMigrationApplied(m, appliedSet, format)
      );

      if (options.dryRun) {
        return {
          schemaName: this.schemaName,
          success: true,
          appliedMigrations: pending.map((m) => m.name),
          durationMs: Date.now() - startTime,
          format: format.format,
        };
      }

      // Apply pending migrations
      for (const migration of pending) {
        const migrationStart = Date.now();
        options.onProgress?.('migrating', migration.name);

        await this.applyMigration(pool, migration, format);
        await this.config.hooks?.afterMigration?.(
          migration.name,
          Date.now() - migrationStart
        );

        appliedMigrations.push(migration.name);
      }

      options.onProgress?.('completed');

      return {
        schemaName: this.schemaName,
        success: true,
        appliedMigrations,
        durationMs: Date.now() - startTime,
        format: format.format,
      };
    } catch (error) {
      options.onProgress?.('failed');

      return {
        schemaName: this.schemaName,
        success: false,
        appliedMigrations,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    } finally {
      await pool.end();
    }
  }

  /**
   * Mark migrations as applied without executing SQL
   *
   * Useful for syncing tracking state with already-applied migrations.
   *
   * @param options - Options with progress callback
   * @returns Result with list of marked migrations
   */
  async markAsApplied(
    options: { onProgress?: SharedMigrateOptions['onProgress'] } = {}
  ): Promise<SharedMigrationResult> {
    const startTime = Date.now();
    const markedMigrations: string[] = [];

    const pool = await this.deps.createPool();

    try {
      options.onProgress?.('starting');

      // Detect or determine the format
      const format = await this.deps.getOrDetectFormat(pool, this.schemaName);

      // Ensure migrations table exists
      await this.deps.ensureMigrationsTable(pool, this.schemaName, format);

      // Load all migrations
      const allMigrations = await this.deps.loadMigrations();

      // Get applied migrations
      const applied = await this.getAppliedMigrations(pool, format);
      const appliedSet = new Set(applied.map((m) => m.identifier));

      // Filter pending migrations
      const pending = allMigrations.filter(
        (m) => !this.isMigrationApplied(m, appliedSet, format)
      );

      // Mark each pending migration as applied
      for (const migration of pending) {
        options.onProgress?.('migrating', migration.name);
        await this.recordMigration(pool, migration, format);
        markedMigrations.push(migration.name);
      }

      options.onProgress?.('completed');

      return {
        schemaName: this.schemaName,
        success: true,
        appliedMigrations: markedMigrations,
        durationMs: Date.now() - startTime,
        format: format.format,
      };
    } catch (error) {
      options.onProgress?.('failed');

      return {
        schemaName: this.schemaName,
        success: false,
        appliedMigrations: markedMigrations,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    } finally {
      await pool.end();
    }
  }

  /**
   * Get migration status for the shared schema
   *
   * @returns Status with applied/pending counts
   */
  async getStatus(): Promise<SharedMigrationStatus> {
    const pool = await this.deps.createPool();

    try {
      const allMigrations = await this.deps.loadMigrations();

      // Check if migrations table exists
      const tableExists = await this.deps.migrationsTableExists(pool, this.schemaName);
      if (!tableExists) {
        return {
          schemaName: this.schemaName,
          appliedCount: 0,
          pendingCount: allMigrations.length,
          pendingMigrations: allMigrations.map((m) => m.name),
          status: allMigrations.length > 0 ? 'behind' : 'ok',
          format: null,
        };
      }

      // Detect the table format
      const format = await this.deps.getOrDetectFormat(pool, this.schemaName);

      const applied = await this.getAppliedMigrations(pool, format);
      const appliedSet = new Set(applied.map((m) => m.identifier));

      const pending = allMigrations.filter(
        (m) => !this.isMigrationApplied(m, appliedSet, format)
      );

      return {
        schemaName: this.schemaName,
        appliedCount: applied.length,
        pendingCount: pending.length,
        pendingMigrations: pending.map((m) => m.name),
        status: pending.length > 0 ? 'behind' : 'ok',
        format: format.format,
      };
    } catch (error) {
      return {
        schemaName: this.schemaName,
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

  /**
   * Get list of applied migrations
   */
  private async getAppliedMigrations(
    pool: Pool,
    format: DetectedFormat
  ): Promise<AppliedMigration[]> {
    const identifierColumn = format.columns.identifier;
    const timestampColumn = format.columns.timestamp;

    const result = await pool.query<AppliedMigrationRecord>(
      `SELECT id, "${identifierColumn}" as identifier, "${timestampColumn}" as applied_at
       FROM "${this.schemaName}"."${format.tableName}"
       ORDER BY id`
    );

    return result.rows.map((row) => {
      const appliedAt = format.columns.timestampType === 'bigint'
        ? new Date(Number(row.applied_at))
        : new Date(row.applied_at);

      return {
        identifier: row.identifier,
        ...(format.columns.identifier === 'name'
          ? { name: row.identifier }
          : { hash: row.identifier }),
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
    return appliedIdentifiers.has(migration.hash) || appliedIdentifiers.has(migration.name);
  }

  /**
   * Apply a migration (execute SQL + record)
   */
  private async applyMigration(
    pool: Pool,
    migration: MigrationFile,
    format: DetectedFormat
  ): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Execute migration SQL
      await client.query(migration.sql);

      // Record migration
      const { identifier, timestamp, timestampType } = format.columns;
      const identifierValue = identifier === 'name' ? migration.name : migration.hash;
      const timestampValue = timestampType === 'bigint' ? Date.now() : new Date();

      await client.query(
        `INSERT INTO "${this.schemaName}"."${format.tableName}" ("${identifier}", "${timestamp}") VALUES ($1, $2)`,
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

  /**
   * Record a migration as applied without executing SQL
   */
  private async recordMigration(
    pool: Pool,
    migration: MigrationFile,
    format: DetectedFormat
  ): Promise<void> {
    const { identifier, timestamp, timestampType } = format.columns;
    const identifierValue = identifier === 'name' ? migration.name : migration.hash;
    const timestampValue = timestampType === 'bigint' ? Date.now() : new Date();

    await pool.query(
      `INSERT INTO "${this.schemaName}"."${format.tableName}" ("${identifier}", "${timestamp}") VALUES ($1, $2)`,
      [identifierValue, timestampValue]
    );
  }
}

/**
 * Factory function to create a SharedMigrationExecutor
 */
export function createSharedMigrationExecutor(
  config: SharedMigrationExecutorConfig,
  dependencies: SharedMigrationExecutorDependencies
): SharedMigrationExecutor {
  return new SharedMigrationExecutor(config, dependencies);
}
