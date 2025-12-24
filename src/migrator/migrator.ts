import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { Config } from '../types.js';
import type {
  MigratorConfig,
  MigrationFile,
  MigrateOptions,
  TenantMigrationResult,
  MigrationResults,
  TenantMigrationStatus,
  AppliedMigration,
  CreateTenantOptions,
  DropTenantOptions,
} from './types.js';
import { detectTableFormat, getFormatConfig, type DetectedFormat, type TableFormat } from './table-format.js';

const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Parallel migration engine for multi-tenant applications
 */
export class Migrator<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
> {
  private readonly migrationsTable: string;

  constructor(
    private readonly tenantConfig: Config<TTenantSchema, TSharedSchema>,
    private readonly migratorConfig: MigratorConfig
  ) {
    this.migrationsTable = migratorConfig.migrationsTable ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /**
   * Migrate all tenants in parallel
   */
  async migrateAll(options: MigrateOptions = {}): Promise<MigrationResults> {
    const {
      concurrency = 10,
      onProgress,
      onError,
      dryRun = false,
    } = options;

    const tenantIds = await this.migratorConfig.tenantDiscovery();
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
            const result = await this.migrateTenant(tenantId, migrations, { dryRun, onProgress });
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
   * Migrate a single tenant
   */
  async migrateTenant(
    tenantId: string,
    migrations?: MigrationFile[],
    options: { dryRun?: boolean; onProgress?: MigrateOptions['onProgress'] } = {}
  ): Promise<TenantMigrationResult> {
    const startTime = Date.now();
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);
    const appliedMigrations: string[] = [];

    const pool = await this.createPool(schemaName);

    try {
      await this.migratorConfig.hooks?.beforeTenant?.(tenantId);

      // Detect or determine the format before creating table
      const format = await this.getOrDetectFormat(pool, schemaName);

      // Ensure migrations table exists with correct format
      await this.ensureMigrationsTable(pool, schemaName, format);

      // Load migrations if not provided
      const allMigrations = migrations ?? await this.loadMigrations();

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
        };
      }

      // Apply pending migrations
      for (const migration of pending) {
        const migrationStart = Date.now();
        options.onProgress?.(tenantId, 'migrating', migration.name);

        await this.migratorConfig.hooks?.beforeMigration?.(tenantId, migration.name);
        await this.applyMigration(pool, schemaName, migration, format);
        await this.migratorConfig.hooks?.afterMigration?.(
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
      };

      await this.migratorConfig.hooks?.afterTenant?.(tenantId, result);

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

      await this.migratorConfig.hooks?.afterTenant?.(tenantId, result);

      return result;
    } finally {
      await pool.end();
    }
  }

  /**
   * Migrate specific tenants
   */
  async migrateTenants(tenantIds: string[], options: MigrateOptions = {}): Promise<MigrationResults> {
    const migrations = await this.loadMigrations();
    const results: TenantMigrationResult[] = [];

    const { concurrency = 10, onProgress, onError } = options;

    for (let i = 0; i < tenantIds.length; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          try {
            onProgress?.(tenantId, 'starting');
            const result = await this.migrateTenant(tenantId, migrations, { dryRun: options.dryRun ?? false, onProgress });
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
   * Get migration status for all tenants
   */
  async getStatus(): Promise<TenantMigrationStatus[]> {
    const tenantIds = await this.migratorConfig.tenantDiscovery();
    const migrations = await this.loadMigrations();
    const statuses: TenantMigrationStatus[] = [];

    for (const tenantId of tenantIds) {
      statuses.push(await this.getTenantStatus(tenantId, migrations));
    }

    return statuses;
  }

  /**
   * Get migration status for a specific tenant
   */
  async getTenantStatus(tenantId: string, migrations?: MigrationFile[]): Promise<TenantMigrationStatus> {
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);
    const pool = await this.createPool(schemaName);

    try {
      const allMigrations = migrations ?? await this.loadMigrations();

      // Check if migrations table exists
      const tableExists = await this.migrationsTableExists(pool, schemaName);
      if (!tableExists) {
        return {
          tenantId,
          schemaName,
          appliedCount: 0,
          pendingCount: allMigrations.length,
          pendingMigrations: allMigrations.map((m) => m.name),
          status: allMigrations.length > 0 ? 'behind' : 'ok',
          format: null, // New tenant, no table yet
        };
      }

      // Detect the table format
      const format = await this.getOrDetectFormat(pool, schemaName);

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

  /**
   * Create a new tenant schema and optionally apply migrations
   */
  async createTenant(tenantId: string, options: CreateTenantOptions = {}): Promise<void> {
    const { migrate = true } = options;
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);

    const pool = new Pool({
      connectionString: this.tenantConfig.connection.url,
      ...this.tenantConfig.connection.poolConfig,
    });

    try {
      // Create schema
      await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

      if (migrate) {
        // Apply all migrations
        await this.migrateTenant(tenantId);
      }
    } finally {
      await pool.end();
    }
  }

  /**
   * Drop a tenant schema
   */
  async dropTenant(tenantId: string, options: DropTenantOptions = {}): Promise<void> {
    const { cascade = true } = options;
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);

    const pool = new Pool({
      connectionString: this.tenantConfig.connection.url,
      ...this.tenantConfig.connection.poolConfig,
    });

    try {
      const cascadeSql = cascade ? 'CASCADE' : 'RESTRICT';
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" ${cascadeSql}`);
    } finally {
      await pool.end();
    }
  }

  /**
   * Check if a tenant schema exists
   */
  async tenantExists(tenantId: string): Promise<boolean> {
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);

    const pool = new Pool({
      connectionString: this.tenantConfig.connection.url,
      ...this.tenantConfig.connection.poolConfig,
    });

    try {
      const result = await pool.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [schemaName]
      );
      return result.rowCount !== null && result.rowCount > 0;
    } finally {
      await pool.end();
    }
  }

  /**
   * Load migration files from the migrations folder
   */
  private async loadMigrations(): Promise<MigrationFile[]> {
    const files = await readdir(this.migratorConfig.migrationsFolder);

    const migrations: MigrationFile[] = [];

    for (const file of files) {
      if (!file.endsWith('.sql')) continue;

      const filePath = join(this.migratorConfig.migrationsFolder, file);
      const content = await readFile(filePath, 'utf-8');

      // Extract timestamp from filename (e.g., 0001_migration_name.sql)
      const match = file.match(/^(\d+)_/);
      const timestamp = match?.[1] ? parseInt(match[1], 10) : 0;

      // Compute SHA-256 hash for drizzle-kit compatibility
      const hash = createHash('sha256').update(content).digest('hex');

      migrations.push({
        name: basename(file, '.sql'),
        path: filePath,
        sql: content,
        timestamp,
        hash,
      });
    }

    // Sort by timestamp
    return migrations.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Create a pool for a specific schema
   */
  private async createPool(schemaName: string): Promise<Pool> {
    return new Pool({
      connectionString: this.tenantConfig.connection.url,
      ...this.tenantConfig.connection.poolConfig,
      options: `-c search_path="${schemaName}",public`,
    });
  }

  /**
   * Ensure migrations table exists with the correct format
   */
  private async ensureMigrationsTable(
    pool: Pool,
    schemaName: string,
    format: DetectedFormat
  ): Promise<void> {
    const { identifier, timestamp, timestampType } = format.columns;

    // Build column definitions based on format
    const identifierCol = identifier === 'name'
      ? 'name VARCHAR(255) NOT NULL UNIQUE'
      : 'hash TEXT NOT NULL';

    const timestampCol = timestampType === 'bigint'
      ? `${timestamp} BIGINT NOT NULL`
      : `${timestamp} TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."${format.tableName}" (
        id SERIAL PRIMARY KEY,
        ${identifierCol},
        ${timestampCol}
      )
    `);
  }

  /**
   * Check if migrations table exists
   */
  private async migrationsTableExists(pool: Pool, schemaName: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2`,
      [schemaName, this.migrationsTable]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Get applied migrations for a schema
   */
  private async getAppliedMigrations(
    pool: Pool,
    schemaName: string,
    format: DetectedFormat
  ): Promise<AppliedMigration[]> {
    const identifierColumn = format.columns.identifier;
    const timestampColumn = format.columns.timestamp;

    const result = await pool.query<{ id: number; identifier: string; applied_at: string | number }>(
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
        id: row.id,
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
   * Get or detect the format for a schema
   * Returns the configured format or auto-detects from existing table
   */
  private async getOrDetectFormat(
    pool: Pool,
    schemaName: string
  ): Promise<DetectedFormat> {
    const configuredFormat = this.migratorConfig.tableFormat ?? 'auto';

    // If not auto, return the configured format
    if (configuredFormat !== 'auto') {
      return getFormatConfig(configuredFormat, this.migrationsTable);
    }

    // Auto-detect from existing table
    const detected = await detectTableFormat(pool, schemaName, this.migrationsTable);

    if (detected) {
      return detected;
    }

    // No table exists, use default format
    const defaultFormat: TableFormat = this.migratorConfig.defaultFormat ?? 'name';
    return getFormatConfig(defaultFormat, this.migrationsTable);
  }

  /**
   * Apply a migration to a schema
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

  /**
   * Create a skipped result
   */
  private createSkippedResult(tenantId: string): TenantMigrationResult {
    return {
      tenantId,
      schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
      success: false,
      appliedMigrations: [],
      error: 'Skipped due to abort',
      durationMs: 0,
    };
  }

  /**
   * Create an error result
   */
  private createErrorResult(tenantId: string, error: Error): TenantMigrationResult {
    return {
      tenantId,
      schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
      success: false,
      appliedMigrations: [],
      error: error.message,
      durationMs: 0,
    };
  }

  /**
   * Aggregate migration results
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
 * Create a migrator instance
 */
export function createMigrator<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
>(
  tenantConfig: Config<TTenantSchema, TSharedSchema>,
  migratorConfig: MigratorConfig
): Migrator<TTenantSchema, TSharedSchema> {
  return new Migrator(tenantConfig, migratorConfig);
}
