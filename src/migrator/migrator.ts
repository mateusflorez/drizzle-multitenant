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
import { SyncManager } from './sync/sync-manager.js';
import { MigrationExecutor } from './executor/migration-executor.js';
import { BatchExecutor } from './executor/batch-executor.js';

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
  private readonly syncManager: SyncManager;
  private readonly migrationExecutor: MigrationExecutor;
  private readonly batchExecutor: BatchExecutor;

  constructor(
    tenantConfig: Config<TTenantSchema, TSharedSchema>,
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
    this.syncManager = new SyncManager(
      {
        tenantDiscovery: migratorConfig.tenantDiscovery,
        migrationsFolder: migratorConfig.migrationsFolder,
        migrationsTable: this.migrationsTable,
      },
      {
        createPool: this.schemaManager.createPool.bind(this.schemaManager),
        schemaNameTemplate: tenantConfig.isolation.schemaNameTemplate,
        migrationsTableExists: this.schemaManager.migrationsTableExists.bind(this.schemaManager),
        ensureMigrationsTable: this.schemaManager.ensureMigrationsTable.bind(this.schemaManager),
        getOrDetectFormat: this.getOrDetectFormat.bind(this),
        loadMigrations: this.loadMigrations.bind(this),
      }
    );

    // Initialize MigrationExecutor (single tenant operations)
    this.migrationExecutor = new MigrationExecutor(
      { hooks: migratorConfig.hooks },
      {
        createPool: this.schemaManager.createPool.bind(this.schemaManager),
        schemaNameTemplate: tenantConfig.isolation.schemaNameTemplate,
        migrationsTableExists: this.schemaManager.migrationsTableExists.bind(this.schemaManager),
        ensureMigrationsTable: this.schemaManager.ensureMigrationsTable.bind(this.schemaManager),
        getOrDetectFormat: this.getOrDetectFormat.bind(this),
        loadMigrations: this.loadMigrations.bind(this),
      }
    );

    // Initialize BatchExecutor (multi-tenant operations)
    this.batchExecutor = new BatchExecutor(
      { tenantDiscovery: migratorConfig.tenantDiscovery },
      this.migrationExecutor,
      this.loadMigrations.bind(this)
    );
  }

  /**
   * Migrate all tenants in parallel
   *
   * Delegates to BatchExecutor for parallel migration operations.
   */
  async migrateAll(options: MigrateOptions = {}): Promise<MigrationResults> {
    return this.batchExecutor.migrateAll(options);
  }

  /**
   * Migrate a single tenant
   *
   * Delegates to MigrationExecutor for single tenant operations.
   */
  async migrateTenant(
    tenantId: string,
    migrations?: MigrationFile[],
    options: { dryRun?: boolean; onProgress?: MigrateOptions['onProgress'] } = {}
  ): Promise<TenantMigrationResult> {
    return this.migrationExecutor.migrateTenant(tenantId, migrations, options);
  }

  /**
   * Migrate specific tenants
   *
   * Delegates to BatchExecutor for parallel migration operations.
   */
  async migrateTenants(tenantIds: string[], options: MigrateOptions = {}): Promise<MigrationResults> {
    return this.batchExecutor.migrateTenants(tenantIds, options);
  }

  /**
   * Get migration status for all tenants
   *
   * Delegates to BatchExecutor for status operations.
   */
  async getStatus(): Promise<TenantMigrationStatus[]> {
    return this.batchExecutor.getStatus();
  }

  /**
   * Get migration status for a specific tenant
   *
   * Delegates to MigrationExecutor for single tenant operations.
   */
  async getTenantStatus(tenantId: string, migrations?: MigrationFile[]): Promise<TenantMigrationStatus> {
    return this.migrationExecutor.getTenantStatus(tenantId, migrations);
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
   *
   * Delegates to MigrationExecutor for single tenant operations.
   */
  async markAsApplied(
    tenantId: string,
    options: { onProgress?: MigrateOptions['onProgress'] } = {}
  ): Promise<TenantMigrationResult> {
    return this.migrationExecutor.markAsApplied(tenantId, options);
  }

  /**
   * Mark migrations as applied for all tenants without executing SQL
   * Useful for syncing tracking state with already-applied migrations
   *
   * Delegates to BatchExecutor for parallel operations.
   */
  async markAllAsApplied(options: MigrateOptions = {}): Promise<MigrationResults> {
    return this.batchExecutor.markAllAsApplied(options);
  }

  // ============================================================================
  // Sync Methods (delegated to SyncManager)
  // ============================================================================

  /**
   * Get sync status for all tenants
   * Detects divergences between migrations on disk and tracking in database
   */
  async getSyncStatus(): Promise<SyncStatus> {
    return this.syncManager.getSyncStatus();
  }

  /**
   * Get sync status for a specific tenant
   */
  async getTenantSyncStatus(tenantId: string, migrations?: MigrationFile[]): Promise<TenantSyncStatus> {
    return this.syncManager.getTenantSyncStatus(tenantId, migrations);
  }

  /**
   * Mark missing migrations as applied for a tenant
   */
  async markMissing(tenantId: string): Promise<TenantSyncResult> {
    return this.syncManager.markMissing(tenantId);
  }

  /**
   * Mark missing migrations as applied for all tenants
   */
  async markAllMissing(options: SyncOptions = {}): Promise<SyncResults> {
    return this.syncManager.markAllMissing(options);
  }

  /**
   * Remove orphan migration records for a tenant
   */
  async cleanOrphans(tenantId: string): Promise<TenantSyncResult> {
    return this.syncManager.cleanOrphans(tenantId);
  }

  /**
   * Remove orphan migration records for all tenants
   */
  async cleanAllOrphans(options: SyncOptions = {}): Promise<SyncResults> {
    return this.syncManager.cleanAllOrphans(options);
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
   * Get or detect the format for a schema
   * Returns the configured format or auto-detects from existing table
   *
   * Note: This method is shared with SyncManager and MigrationExecutor via dependency injection.
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
