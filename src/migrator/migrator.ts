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
  TenantSyncStatus,
  SyncStatus,
  TenantSyncResult,
  SyncResults,
  SyncOptions,
  SeedFunction,
  SeedOptions,
  TenantSeedResult,
  SeedResults,
  // Schema drift detection types (delegated to DriftDetector)
  TenantSchema,
  TenantSchemaDrift,
  SchemaDriftStatus,
  SchemaDriftOptions,
} from './types.js';
import { detectTableFormat, getFormatConfig, type DetectedFormat, type TableFormat } from './table-format.js';
import { SchemaManager } from './schema-manager.js';
import { DriftDetector } from './drift/drift-detector.js';
import { Seeder } from './seed/seeder.js';

const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Parallel migration engine for multi-tenant applications
 */
export class Migrator<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
> {
  private readonly migrationsTable: string;
  private readonly schemaManager: SchemaManager<TTenantSchema, TSharedSchema>;
  private readonly driftDetector: DriftDetector<TTenantSchema, TSharedSchema>;
  private readonly seeder: Seeder<TTenantSchema>;

  constructor(
    private readonly tenantConfig: Config<TTenantSchema, TSharedSchema>,
    private readonly migratorConfig: MigratorConfig
  ) {
    this.migrationsTable = migratorConfig.migrationsTable ?? DEFAULT_MIGRATIONS_TABLE;
    this.schemaManager = new SchemaManager(tenantConfig, this.migrationsTable);
    this.driftDetector = new DriftDetector(tenantConfig, this.schemaManager, {
      migrationsTable: this.migrationsTable,
      tenantDiscovery: migratorConfig.tenantDiscovery,
    });
    this.seeder = new Seeder(
      { tenantDiscovery: migratorConfig.tenantDiscovery },
      {
        createPool: this.schemaManager.createPool.bind(this.schemaManager),
        schemaNameTemplate: tenantConfig.isolation.schemaNameTemplate,
        tenantSchema: tenantConfig.schemas.tenant as TTenantSchema,
      }
    );
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

    // Delegate schema creation to SchemaManager
    await this.schemaManager.createSchema(tenantId);

    if (migrate) {
      // Apply all migrations
      await this.migrateTenant(tenantId);
    }
  }

  /**
   * Drop a tenant schema
   */
  async dropTenant(tenantId: string, options: DropTenantOptions = {}): Promise<void> {
    // Delegate to SchemaManager
    await this.schemaManager.dropSchema(tenantId, options);
  }

  /**
   * Check if a tenant schema exists
   */
  async tenantExists(tenantId: string): Promise<boolean> {
    // Delegate to SchemaManager
    return this.schemaManager.schemaExists(tenantId);
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

  // ============================================================================
  // Seeding Methods (delegated to Seeder)
  // ============================================================================

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
    return this.seeder.seedTenant(tenantId, seedFn);
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
    return this.seeder.seedAll(seedFn, options);
  }

  /**
   * Seed specific tenants with initial data
   */
  async seedTenants(
    tenantIds: string[],
    seedFn: SeedFunction<TTenantSchema>,
    options: SeedOptions = {}
  ): Promise<SeedResults> {
    return this.seeder.seedTenants(tenantIds, seedFn, options);
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
   * @deprecated Use schemaManager.createPool() directly
   */
  private async createPool(schemaName: string): Promise<Pool> {
    return this.schemaManager.createPool(schemaName);
  }

  /**
   * Ensure migrations table exists with the correct format
   * @deprecated Use schemaManager.ensureMigrationsTable() directly
   */
  private async ensureMigrationsTable(
    pool: Pool,
    schemaName: string,
    format: DetectedFormat
  ): Promise<void> {
    return this.schemaManager.ensureMigrationsTable(pool, schemaName, format);
  }

  /**
   * Check if migrations table exists
   * @deprecated Use schemaManager.migrationsTableExists() directly
   */
  private async migrationsTableExists(pool: Pool, schemaName: string): Promise<boolean> {
    return this.schemaManager.migrationsTableExists(pool, schemaName);
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

  // ============================================================================
  // Schema Drift Detection Methods (delegated to DriftDetector)
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
    return this.driftDetector.detectDrift(options);
  }

  /**
   * Get schema drift for a specific tenant compared to a reference
   */
  async getTenantSchemaDrift(
    tenantId: string,
    referenceTenantId: string,
    options: Pick<SchemaDriftOptions, 'includeIndexes' | 'includeConstraints' | 'excludeTables'> = {}
  ): Promise<TenantSchemaDrift> {
    return this.driftDetector.compareTenant(tenantId, referenceTenantId, options);
  }

  /**
   * Introspect the schema of a tenant
   */
  async introspectTenantSchema(
    tenantId: string,
    options: { includeIndexes?: boolean; includeConstraints?: boolean; excludeTables?: string[] } = {}
  ): Promise<TenantSchema | null> {
    return this.driftDetector.introspectSchema(tenantId, options);
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
