import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
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
  TenantSyncStatus,
  SyncStatus,
  TenantSyncResult,
  SyncResults,
  SyncOptions,
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
          format: format.format,
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
        format: format.format,
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
   * Mark migrations as applied without executing SQL
   * Useful for syncing tracking state with already-applied migrations
   */
  async markAsApplied(
    tenantId: string,
    options: { onProgress?: MigrateOptions['onProgress'] } = {}
  ): Promise<TenantMigrationResult> {
    const startTime = Date.now();
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);
    const markedMigrations: string[] = [];

    const pool = await this.createPool(schemaName);

    try {
      await this.migratorConfig.hooks?.beforeTenant?.(tenantId);

      // Detect or determine the format before creating table
      const format = await this.getOrDetectFormat(pool, schemaName);

      // Ensure migrations table exists with correct format
      await this.ensureMigrationsTable(pool, schemaName, format);

      // Load all migrations
      const allMigrations = await this.loadMigrations();

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

        await this.migratorConfig.hooks?.beforeMigration?.(tenantId, migration.name);
        await this.recordMigration(pool, schemaName, migration, format);
        await this.migratorConfig.hooks?.afterMigration?.(
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

      await this.migratorConfig.hooks?.afterTenant?.(tenantId, result);

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

      await this.migratorConfig.hooks?.afterTenant?.(tenantId, result);

      return result;
    } finally {
      await pool.end();
    }
  }

  /**
   * Mark migrations as applied for all tenants without executing SQL
   * Useful for syncing tracking state with already-applied migrations
   */
  async markAllAsApplied(options: MigrateOptions = {}): Promise<MigrationResults> {
    const {
      concurrency = 10,
      onProgress,
      onError,
    } = options;

    const tenantIds = await this.migratorConfig.tenantDiscovery();
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
            const result = await this.markAsApplied(tenantId, { onProgress });
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
   * Get sync status for all tenants
   * Detects divergences between migrations on disk and tracking in database
   */
  async getSyncStatus(): Promise<SyncStatus> {
    const tenantIds = await this.migratorConfig.tenantDiscovery();
    const migrations = await this.loadMigrations();
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
   */
  async getTenantSyncStatus(tenantId: string, migrations?: MigrationFile[]): Promise<TenantSyncStatus> {
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);
    const pool = await this.createPool(schemaName);

    try {
      const allMigrations = migrations ?? await this.loadMigrations();
      const migrationNames = new Set(allMigrations.map((m) => m.name));
      const migrationHashes = new Set(allMigrations.map((m) => m.hash));

      // Check if migrations table exists
      const tableExists = await this.migrationsTableExists(pool, schemaName);
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
      const format = await this.getOrDetectFormat(pool, schemaName);
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
   */
  async markMissing(tenantId: string): Promise<TenantSyncResult> {
    const startTime = Date.now();
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);
    const markedMigrations: string[] = [];

    const pool = await this.createPool(schemaName);

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

      const format = await this.getOrDetectFormat(pool, schemaName);
      await this.ensureMigrationsTable(pool, schemaName, format);

      const allMigrations = await this.loadMigrations();
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
   */
  async markAllMissing(options: SyncOptions = {}): Promise<SyncResults> {
    const { concurrency = 10, onProgress, onError } = options;

    const tenantIds = await this.migratorConfig.tenantDiscovery();
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
   */
  async cleanOrphans(tenantId: string): Promise<TenantSyncResult> {
    const startTime = Date.now();
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);
    const removedOrphans: string[] = [];

    const pool = await this.createPool(schemaName);

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

      const format = await this.getOrDetectFormat(pool, schemaName);
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
   */
  async cleanAllOrphans(options: SyncOptions = {}): Promise<SyncResults> {
    const { concurrency = 10, onProgress, onError } = options;

    const tenantIds = await this.migratorConfig.tenantDiscovery();
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

  /**
   * Seed a single tenant with initial data
   *
   * @example
   * ```typescript
   * const seed: SeedFunction = async (db, tenantId) => {
   *   await db.insert(roles).values([
   *     { name: 'admin', permissions: ['*'] },
   *     { name: 'user', permissions: ['read'] },
   *   ]);
   * };
   *
   * await migrator.seedTenant('tenant-123', seed);
   * ```
   */
  async seedTenant(
    tenantId: string,
    seedFn: SeedFunction<TTenantSchema>
  ): Promise<TenantSeedResult> {
    const startTime = Date.now();
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);

    const pool = await this.createPool(schemaName);

    try {
      // Create a drizzle instance with the tenant schema
      const db = drizzle(pool, {
        schema: this.tenantConfig.schemas.tenant as TTenantSchema,
      });

      // Execute the seed function
      await seedFn(db as any, tenantId);

      return {
        tenantId,
        schemaName,
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        tenantId,
        schemaName,
        success: false,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    } finally {
      await pool.end();
    }
  }

  /**
   * Seed all tenants with initial data in parallel
   *
   * @example
   * ```typescript
   * const seed: SeedFunction = async (db, tenantId) => {
   *   await db.insert(roles).values([
   *     { name: 'admin', permissions: ['*'] },
   *   ]);
   * };
   *
   * await migrator.seedAll(seed, { concurrency: 10 });
   * ```
   */
  async seedAll(
    seedFn: SeedFunction<TTenantSchema>,
    options: SeedOptions = {}
  ): Promise<SeedResults> {
    const {
      concurrency = 10,
      onProgress,
      onError,
    } = options;

    const tenantIds = await this.migratorConfig.tenantDiscovery();
    const results: TenantSeedResult[] = [];
    let aborted = false;

    // Process tenants in batches
    for (let i = 0; i < tenantIds.length && !aborted; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          if (aborted) {
            return this.createSkippedSeedResult(tenantId);
          }

          try {
            onProgress?.(tenantId, 'starting');
            onProgress?.(tenantId, 'seeding');
            const result = await this.seedTenant(tenantId, seedFn);
            onProgress?.(tenantId, result.success ? 'completed' : 'failed');
            return result;
          } catch (error) {
            onProgress?.(tenantId, 'failed');
            const action = onError?.(tenantId, error as Error);
            if (action === 'abort') {
              aborted = true;
            }
            return this.createErrorSeedResult(tenantId, error as Error);
          }
        })
      );

      results.push(...batchResults);
    }

    // Mark remaining tenants as skipped if aborted
    if (aborted) {
      const remaining = tenantIds.slice(results.length);
      for (const tenantId of remaining) {
        results.push(this.createSkippedSeedResult(tenantId));
      }
    }

    return this.aggregateSeedResults(results);
  }

  /**
   * Seed specific tenants with initial data
   */
  async seedTenants(
    tenantIds: string[],
    seedFn: SeedFunction<TTenantSchema>,
    options: SeedOptions = {}
  ): Promise<SeedResults> {
    const { concurrency = 10, onProgress, onError } = options;

    const results: TenantSeedResult[] = [];

    for (let i = 0; i < tenantIds.length; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          try {
            onProgress?.(tenantId, 'starting');
            onProgress?.(tenantId, 'seeding');
            const result = await this.seedTenant(tenantId, seedFn);
            onProgress?.(tenantId, result.success ? 'completed' : 'failed');
            return result;
          } catch (error) {
            onProgress?.(tenantId, 'failed');
            onError?.(tenantId, error as Error);
            return this.createErrorSeedResult(tenantId, error as Error);
          }
        })
      );

      results.push(...batchResults);
    }

    return this.aggregateSeedResults(results);
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
   * Record a migration as applied without executing SQL
   * Used by markAsApplied to sync tracking state
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

  /**
   * Create a skipped sync result
   */
  private createSkippedSyncResult(tenantId: string): TenantSyncResult {
    return {
      tenantId,
      schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
      success: false,
      markedMigrations: [],
      removedOrphans: [],
      error: 'Skipped due to abort',
      durationMs: 0,
    };
  }

  /**
   * Create an error sync result
   */
  private createErrorSyncResult(tenantId: string, error: Error): TenantSyncResult {
    return {
      tenantId,
      schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
      success: false,
      markedMigrations: [],
      removedOrphans: [],
      error: error.message,
      durationMs: 0,
    };
  }

  /**
   * Aggregate sync results
   */
  private aggregateSyncResults(results: TenantSyncResult[]): SyncResults {
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      details: results,
    };
  }

  /**
   * Create a skipped seed result
   */
  private createSkippedSeedResult(tenantId: string): TenantSeedResult {
    return {
      tenantId,
      schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
      success: false,
      error: 'Skipped due to abort',
      durationMs: 0,
    };
  }

  /**
   * Create an error seed result
   */
  private createErrorSeedResult(tenantId: string, error: Error): TenantSeedResult {
    return {
      tenantId,
      schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
      success: false,
      error: error.message,
      durationMs: 0,
    };
  }

  /**
   * Aggregate seed results
   */
  private aggregateSeedResults(results: TenantSeedResult[]): SeedResults {
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success && r.error !== 'Skipped due to abort').length,
      skipped: results.filter((r) => r.error === 'Skipped due to abort').length,
      details: results,
    };
  }

  // ============================================================================
  // Schema Drift Detection Methods
  // ============================================================================

  /**
   * Detect schema drift across all tenants
   * Compares each tenant's schema against a reference tenant (first tenant by default)
   *
   * @example
   * ```typescript
   * const drift = await migrator.getSchemaDrift();
   * if (drift.withDrift > 0) {
   *   console.log('Schema drift detected!');
   *   for (const tenant of drift.details) {
   *     if (tenant.hasDrift) {
   *       console.log(`Tenant ${tenant.tenantId} has drift:`);
   *       for (const table of tenant.tables) {
   *         for (const col of table.columns) {
   *           console.log(`  - ${table.table}.${col.column}: ${col.description}`);
   *         }
   *       }
   *     }
   *   }
   * }
   * ```
   */
  async getSchemaDrift(options: SchemaDriftOptions = {}): Promise<SchemaDriftStatus> {
    const startTime = Date.now();
    const {
      concurrency = 10,
      includeIndexes = true,
      includeConstraints = true,
      excludeTables = [this.migrationsTable],
      onProgress,
    } = options;

    // Get tenant IDs to check
    const tenantIds = options.tenantIds ?? await this.migratorConfig.tenantDiscovery();

    if (tenantIds.length === 0) {
      return {
        referenceTenant: '',
        total: 0,
        noDrift: 0,
        withDrift: 0,
        error: 0,
        details: [],
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    }

    // Determine reference tenant
    const referenceTenant = options.referenceTenant ?? tenantIds[0]!;

    // Get reference schema
    onProgress?.(referenceTenant, 'starting');
    onProgress?.(referenceTenant, 'introspecting');
    const referenceSchema = await this.introspectTenantSchema(referenceTenant, {
      includeIndexes,
      includeConstraints,
      excludeTables,
    });

    if (!referenceSchema) {
      return {
        referenceTenant,
        total: tenantIds.length,
        noDrift: 0,
        withDrift: 0,
        error: tenantIds.length,
        details: tenantIds.map((id) => ({
          tenantId: id,
          schemaName: this.tenantConfig.isolation.schemaNameTemplate(id),
          hasDrift: false,
          tables: [],
          issueCount: 0,
          error: id === referenceTenant ? 'Failed to introspect reference tenant' : 'Reference tenant introspection failed',
        })),
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
    }

    onProgress?.(referenceTenant, 'completed');

    // Filter out reference tenant from comparison
    const tenantsToCheck = tenantIds.filter((id) => id !== referenceTenant);

    // Compare each tenant against reference
    const results: TenantSchemaDrift[] = [];

    // Add reference tenant as "no drift" (it's the baseline)
    results.push({
      tenantId: referenceTenant,
      schemaName: referenceSchema.schemaName,
      hasDrift: false,
      tables: [],
      issueCount: 0,
    });

    // Process tenants in batches
    for (let i = 0; i < tenantsToCheck.length; i += concurrency) {
      const batch = tenantsToCheck.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          try {
            onProgress?.(tenantId, 'starting');
            onProgress?.(tenantId, 'introspecting');

            const tenantSchema = await this.introspectTenantSchema(tenantId, {
              includeIndexes,
              includeConstraints,
              excludeTables,
            });

            if (!tenantSchema) {
              onProgress?.(tenantId, 'failed');
              return {
                tenantId,
                schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
                hasDrift: false,
                tables: [],
                issueCount: 0,
                error: 'Failed to introspect schema',
              };
            }

            onProgress?.(tenantId, 'comparing');

            const drift = this.compareSchemas(referenceSchema, tenantSchema, {
              includeIndexes,
              includeConstraints,
            });

            onProgress?.(tenantId, 'completed');

            return drift;
          } catch (error) {
            onProgress?.(tenantId, 'failed');
            return {
              tenantId,
              schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
              hasDrift: false,
              tables: [],
              issueCount: 0,
              error: (error as Error).message,
            };
          }
        })
      );

      results.push(...batchResults);
    }

    return {
      referenceTenant,
      total: results.length,
      noDrift: results.filter((r) => !r.hasDrift && !r.error).length,
      withDrift: results.filter((r) => r.hasDrift && !r.error).length,
      error: results.filter((r) => !!r.error).length,
      details: results,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Get schema drift for a specific tenant compared to a reference
   */
  async getTenantSchemaDrift(
    tenantId: string,
    referenceTenantId: string,
    options: Pick<SchemaDriftOptions, 'includeIndexes' | 'includeConstraints' | 'excludeTables'> = {}
  ): Promise<TenantSchemaDrift> {
    const {
      includeIndexes = true,
      includeConstraints = true,
      excludeTables = [this.migrationsTable],
    } = options;

    const referenceSchema = await this.introspectTenantSchema(referenceTenantId, {
      includeIndexes,
      includeConstraints,
      excludeTables,
    });

    if (!referenceSchema) {
      return {
        tenantId,
        schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
        hasDrift: false,
        tables: [],
        issueCount: 0,
        error: 'Failed to introspect reference tenant',
      };
    }

    const tenantSchema = await this.introspectTenantSchema(tenantId, {
      includeIndexes,
      includeConstraints,
      excludeTables,
    });

    if (!tenantSchema) {
      return {
        tenantId,
        schemaName: this.tenantConfig.isolation.schemaNameTemplate(tenantId),
        hasDrift: false,
        tables: [],
        issueCount: 0,
        error: 'Failed to introspect tenant schema',
      };
    }

    return this.compareSchemas(referenceSchema, tenantSchema, {
      includeIndexes,
      includeConstraints,
    });
  }

  /**
   * Introspect the schema of a tenant
   */
  async introspectTenantSchema(
    tenantId: string,
    options: { includeIndexes?: boolean; includeConstraints?: boolean; excludeTables?: string[] } = {}
  ): Promise<TenantSchema | null> {
    const schemaName = this.tenantConfig.isolation.schemaNameTemplate(tenantId);
    const pool = await this.createPool(schemaName);

    try {
      const tables = await this.introspectTables(pool, schemaName, options);

      return {
        tenantId,
        schemaName,
        tables,
        introspectedAt: new Date(),
      };
    } catch {
      return null;
    } finally {
      await pool.end();
    }
  }

  /**
   * Introspect all tables in a schema
   */
  private async introspectTables(
    pool: Pool,
    schemaName: string,
    options: { includeIndexes?: boolean; includeConstraints?: boolean; excludeTables?: string[] }
  ): Promise<TableSchema[]> {
    const { includeIndexes = true, includeConstraints = true, excludeTables = [] } = options;

    // Get all tables in schema
    const tablesResult = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schemaName]
    );

    const tables: TableSchema[] = [];

    for (const row of tablesResult.rows) {
      if (excludeTables.includes(row.table_name)) {
        continue;
      }

      const columns = await this.introspectColumns(pool, schemaName, row.table_name);
      const indexes = includeIndexes ? await this.introspectIndexes(pool, schemaName, row.table_name) : [];
      const constraints = includeConstraints ? await this.introspectConstraints(pool, schemaName, row.table_name) : [];

      tables.push({
        name: row.table_name,
        columns,
        indexes,
        constraints,
      });
    }

    return tables;
  }

  /**
   * Introspect columns for a table
   */
  private async introspectColumns(pool: Pool, schemaName: string, tableName: string): Promise<ColumnInfo[]> {
    const result = await pool.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
      ordinal_position: number;
    }>(
      `SELECT
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        ordinal_position
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schemaName, tableName]
    );

    return result.rows.map((row) => ({
      name: row.column_name,
      dataType: row.data_type,
      udtName: row.udt_name,
      isNullable: row.is_nullable === 'YES',
      columnDefault: row.column_default,
      characterMaximumLength: row.character_maximum_length,
      numericPrecision: row.numeric_precision,
      numericScale: row.numeric_scale,
      ordinalPosition: row.ordinal_position,
    }));
  }

  /**
   * Introspect indexes for a table
   */
  private async introspectIndexes(pool: Pool, schemaName: string, tableName: string): Promise<IndexInfo[]> {
    const result = await pool.query<{
      indexname: string;
      indexdef: string;
    }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = $1 AND tablename = $2
       ORDER BY indexname`,
      [schemaName, tableName]
    );

    // Get index columns from pg_index
    const indexDetails = await pool.query<{
      indexname: string;
      column_name: string;
      is_unique: boolean;
      is_primary: boolean;
    }>(
      `SELECT
        i.relname as indexname,
        a.attname as column_name,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = $2
       ORDER BY i.relname, a.attnum`,
      [schemaName, tableName]
    );

    // Group columns by index
    const indexColumnsMap = new Map<string, { columns: string[]; isUnique: boolean; isPrimary: boolean }>();
    for (const row of indexDetails.rows) {
      const existing = indexColumnsMap.get(row.indexname);
      if (existing) {
        existing.columns.push(row.column_name);
      } else {
        indexColumnsMap.set(row.indexname, {
          columns: [row.column_name],
          isUnique: row.is_unique,
          isPrimary: row.is_primary,
        });
      }
    }

    return result.rows.map((row) => {
      const details = indexColumnsMap.get(row.indexname);
      return {
        name: row.indexname,
        columns: details?.columns ?? [],
        isUnique: details?.isUnique ?? false,
        isPrimary: details?.isPrimary ?? false,
        definition: row.indexdef,
      };
    });
  }

  /**
   * Introspect constraints for a table
   */
  private async introspectConstraints(pool: Pool, schemaName: string, tableName: string): Promise<ConstraintInfo[]> {
    const result = await pool.query<{
      constraint_name: string;
      constraint_type: string;
      column_name: string;
      foreign_table_schema: string | null;
      foreign_table_name: string | null;
      foreign_column_name: string | null;
      check_clause: string | null;
    }>(
      `SELECT
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_schema as foreign_table_schema,
        ccu.table_name as foreign_table_name,
        ccu.column_name as foreign_column_name,
        cc.check_clause
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       LEFT JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
         AND tc.constraint_type = 'FOREIGN KEY'
       LEFT JOIN information_schema.check_constraints cc
         ON tc.constraint_name = cc.constraint_name
         AND tc.constraint_type = 'CHECK'
       WHERE tc.table_schema = $1 AND tc.table_name = $2
       ORDER BY tc.constraint_name, kcu.ordinal_position`,
      [schemaName, tableName]
    );

    // Group by constraint name
    const constraintMap = new Map<string, ConstraintInfo>();
    for (const row of result.rows) {
      const existing = constraintMap.get(row.constraint_name);
      if (existing) {
        if (row.column_name && !existing.columns.includes(row.column_name)) {
          existing.columns.push(row.column_name);
        }
        if (row.foreign_column_name && existing.foreignColumns && !existing.foreignColumns.includes(row.foreign_column_name)) {
          existing.foreignColumns.push(row.foreign_column_name);
        }
      } else {
        const constraint: ConstraintInfo = {
          name: row.constraint_name,
          type: row.constraint_type as ConstraintInfo['type'],
          columns: row.column_name ? [row.column_name] : [],
        };
        if (row.foreign_table_name) {
          constraint.foreignTable = row.foreign_table_name;
        }
        if (row.foreign_column_name) {
          constraint.foreignColumns = [row.foreign_column_name];
        }
        if (row.check_clause) {
          constraint.checkExpression = row.check_clause;
        }
        constraintMap.set(row.constraint_name, constraint);
      }
    }

    return Array.from(constraintMap.values());
  }

  /**
   * Compare two schemas and return drift details
   */
  private compareSchemas(
    reference: TenantSchema,
    target: TenantSchema,
    options: { includeIndexes?: boolean; includeConstraints?: boolean }
  ): TenantSchemaDrift {
    const { includeIndexes = true, includeConstraints = true } = options;
    const tableDrifts: TableDrift[] = [];
    let totalIssues = 0;

    const refTableMap = new Map(reference.tables.map((t) => [t.name, t]));
    const targetTableMap = new Map(target.tables.map((t) => [t.name, t]));

    // Check for missing and drifted tables
    for (const refTable of reference.tables) {
      const targetTable = targetTableMap.get(refTable.name);

      if (!targetTable) {
        // Table is missing in target
        tableDrifts.push({
          table: refTable.name,
          status: 'missing',
          columns: refTable.columns.map((c) => ({
            column: c.name,
            type: 'missing',
            expected: c.dataType,
            description: `Column "${c.name}" (${c.dataType}) is missing`,
          })),
          indexes: [],
          constraints: [],
        });
        totalIssues += refTable.columns.length;
        continue;
      }

      // Compare table structure
      const columnDrifts = this.compareColumns(refTable.columns, targetTable.columns);
      const indexDrifts = includeIndexes ? this.compareIndexes(refTable.indexes, targetTable.indexes) : [];
      const constraintDrifts = includeConstraints ? this.compareConstraints(refTable.constraints, targetTable.constraints) : [];

      const issues = columnDrifts.length + indexDrifts.length + constraintDrifts.length;
      totalIssues += issues;

      if (issues > 0) {
        tableDrifts.push({
          table: refTable.name,
          status: 'drifted',
          columns: columnDrifts,
          indexes: indexDrifts,
          constraints: constraintDrifts,
        });
      }
    }

    // Check for extra tables in target
    for (const targetTable of target.tables) {
      if (!refTableMap.has(targetTable.name)) {
        tableDrifts.push({
          table: targetTable.name,
          status: 'extra',
          columns: targetTable.columns.map((c) => ({
            column: c.name,
            type: 'extra',
            actual: c.dataType,
            description: `Extra column "${c.name}" (${c.dataType}) not in reference`,
          })),
          indexes: [],
          constraints: [],
        });
        totalIssues += targetTable.columns.length;
      }
    }

    return {
      tenantId: target.tenantId,
      schemaName: target.schemaName,
      hasDrift: totalIssues > 0,
      tables: tableDrifts,
      issueCount: totalIssues,
    };
  }

  /**
   * Compare columns between reference and target
   */
  private compareColumns(reference: ColumnInfo[], target: ColumnInfo[]): ColumnDrift[] {
    const drifts: ColumnDrift[] = [];
    const refColMap = new Map(reference.map((c) => [c.name, c]));
    const targetColMap = new Map(target.map((c) => [c.name, c]));

    // Check for missing and drifted columns
    for (const refCol of reference) {
      const targetCol = targetColMap.get(refCol.name);

      if (!targetCol) {
        drifts.push({
          column: refCol.name,
          type: 'missing',
          expected: refCol.dataType,
          description: `Column "${refCol.name}" (${refCol.dataType}) is missing`,
        });
        continue;
      }

      // Compare data types (normalize by comparing udt_name)
      if (refCol.udtName !== targetCol.udtName) {
        drifts.push({
          column: refCol.name,
          type: 'type_mismatch',
          expected: refCol.udtName,
          actual: targetCol.udtName,
          description: `Column "${refCol.name}" type mismatch: expected "${refCol.udtName}", got "${targetCol.udtName}"`,
        });
      }

      // Compare nullable
      if (refCol.isNullable !== targetCol.isNullable) {
        drifts.push({
          column: refCol.name,
          type: 'nullable_mismatch',
          expected: refCol.isNullable,
          actual: targetCol.isNullable,
          description: `Column "${refCol.name}" nullable mismatch: expected ${refCol.isNullable ? 'NULL' : 'NOT NULL'}, got ${targetCol.isNullable ? 'NULL' : 'NOT NULL'}`,
        });
      }

      // Compare defaults (normalize by removing schema qualifiers)
      const normalizedRefDefault = this.normalizeDefault(refCol.columnDefault);
      const normalizedTargetDefault = this.normalizeDefault(targetCol.columnDefault);
      if (normalizedRefDefault !== normalizedTargetDefault) {
        drifts.push({
          column: refCol.name,
          type: 'default_mismatch',
          expected: refCol.columnDefault,
          actual: targetCol.columnDefault,
          description: `Column "${refCol.name}" default mismatch: expected "${refCol.columnDefault ?? 'none'}", got "${targetCol.columnDefault ?? 'none'}"`,
        });
      }
    }

    // Check for extra columns
    for (const targetCol of target) {
      if (!refColMap.has(targetCol.name)) {
        drifts.push({
          column: targetCol.name,
          type: 'extra',
          actual: targetCol.dataType,
          description: `Extra column "${targetCol.name}" (${targetCol.dataType}) not in reference`,
        });
      }
    }

    return drifts;
  }

  /**
   * Normalize default value for comparison
   */
  private normalizeDefault(value: string | null): string | null {
    if (value === null) return null;
    // Remove schema qualifiers and normalize common patterns
    return value
      .replace(/^'(.+)'::.+$/, '$1') // '123'::integer -> 123
      .replace(/^(.+)::.+$/, '$1')   // value::type -> value
      .trim();
  }

  /**
   * Compare indexes between reference and target
   */
  private compareIndexes(reference: IndexInfo[], target: IndexInfo[]): IndexDrift[] {
    const drifts: IndexDrift[] = [];
    const refIndexMap = new Map(reference.map((i) => [i.name, i]));
    const targetIndexMap = new Map(target.map((i) => [i.name, i]));

    // Check for missing indexes
    for (const refIndex of reference) {
      const targetIndex = targetIndexMap.get(refIndex.name);

      if (!targetIndex) {
        drifts.push({
          index: refIndex.name,
          type: 'missing',
          expected: refIndex.definition,
          description: `Index "${refIndex.name}" is missing`,
        });
        continue;
      }

      // Compare columns
      const refCols = refIndex.columns.sort().join(',');
      const targetCols = targetIndex.columns.sort().join(',');
      if (refCols !== targetCols || refIndex.isUnique !== targetIndex.isUnique) {
        drifts.push({
          index: refIndex.name,
          type: 'definition_mismatch',
          expected: refIndex.definition,
          actual: targetIndex.definition,
          description: `Index "${refIndex.name}" definition differs`,
        });
      }
    }

    // Check for extra indexes
    for (const targetIndex of target) {
      if (!refIndexMap.has(targetIndex.name)) {
        drifts.push({
          index: targetIndex.name,
          type: 'extra',
          actual: targetIndex.definition,
          description: `Extra index "${targetIndex.name}" not in reference`,
        });
      }
    }

    return drifts;
  }

  /**
   * Compare constraints between reference and target
   */
  private compareConstraints(reference: ConstraintInfo[], target: ConstraintInfo[]): ConstraintDrift[] {
    const drifts: ConstraintDrift[] = [];
    const refConstraintMap = new Map(reference.map((c) => [c.name, c]));
    const targetConstraintMap = new Map(target.map((c) => [c.name, c]));

    // Check for missing constraints
    for (const refConstraint of reference) {
      const targetConstraint = targetConstraintMap.get(refConstraint.name);

      if (!targetConstraint) {
        drifts.push({
          constraint: refConstraint.name,
          type: 'missing',
          expected: `${refConstraint.type} on (${refConstraint.columns.join(', ')})`,
          description: `Constraint "${refConstraint.name}" (${refConstraint.type}) is missing`,
        });
        continue;
      }

      // Compare constraint details
      const refCols = refConstraint.columns.sort().join(',');
      const targetCols = targetConstraint.columns.sort().join(',');
      if (refConstraint.type !== targetConstraint.type || refCols !== targetCols) {
        drifts.push({
          constraint: refConstraint.name,
          type: 'definition_mismatch',
          expected: `${refConstraint.type} on (${refConstraint.columns.join(', ')})`,
          actual: `${targetConstraint.type} on (${targetConstraint.columns.join(', ')})`,
          description: `Constraint "${refConstraint.name}" definition differs`,
        });
      }
    }

    // Check for extra constraints
    for (const targetConstraint of target) {
      if (!refConstraintMap.has(targetConstraint.name)) {
        drifts.push({
          constraint: targetConstraint.name,
          type: 'extra',
          actual: `${targetConstraint.type} on (${targetConstraint.columns.join(', ')})`,
          description: `Extra constraint "${targetConstraint.name}" (${targetConstraint.type}) not in reference`,
        });
      }
    }

    return drifts;
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
