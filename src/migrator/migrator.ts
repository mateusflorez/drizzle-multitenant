import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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
  // Shared schema migration types
  SharedMigrationStatus,
  SharedMigrationResult,
  SharedMigrateOptions,
  // Shared schema seeding types
  SharedSeedFunction,
  SharedSeedResult,
} from './types.js';
import { detectTableFormat, getFormatConfig, type DetectedFormat, type TableFormat } from './table-format.js';
import { SchemaManager } from './schema-manager.js';
import { DriftDetector } from './drift/drift-detector.js';
import { Seeder } from './seed/seeder.js';
import { SharedSeeder } from './seed/shared-seeder.js';
import { SyncManager } from './sync/sync-manager.js';
import { MigrationExecutor } from './executor/migration-executor.js';
import { BatchExecutor } from './executor/batch-executor.js';
import { Cloner } from './clone/cloner.js';
import { SharedMigrationExecutor } from './shared/shared-migration-executor.js';
import type { CloneTenantOptions, CloneTenantResult } from './clone/types.js';

const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations';
const DEFAULT_SHARED_MIGRATIONS_TABLE = '__drizzle_shared_migrations';

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
  private readonly cloner: Cloner;
  private readonly sharedMigrationExecutor: SharedMigrationExecutor | null;
  private readonly sharedSeeder: SharedSeeder<TSharedSchema> | null;

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

    // Initialize Cloner (tenant cloning operations)
    this.cloner = new Cloner(
      { migrationsTable: this.migrationsTable },
      {
        createPool: this.schemaManager.createPool.bind(this.schemaManager),
        createRootPool: this.schemaManager.createRootPool.bind(this.schemaManager),
        schemaNameTemplate: tenantConfig.isolation.schemaNameTemplate,
        schemaExists: this.schemaManager.schemaExists.bind(this.schemaManager),
        createSchema: this.schemaManager.createSchema.bind(this.schemaManager),
      }
    );

    // Initialize SharedMigrationExecutor (if shared migrations folder is configured)
    if (migratorConfig.sharedMigrationsFolder && existsSync(migratorConfig.sharedMigrationsFolder)) {
      const sharedMigrationsTable = migratorConfig.sharedMigrationsTable ?? DEFAULT_SHARED_MIGRATIONS_TABLE;

      const sharedHooks = migratorConfig.sharedHooks;
      const executorConfig: import('./shared/types.js').SharedMigrationExecutorConfig = {
        schemaName: 'public',
        migrationsTable: sharedMigrationsTable,
      };

      if (sharedHooks?.beforeMigration || sharedHooks?.afterApply) {
        executorConfig.hooks = {};
        if (sharedHooks.beforeMigration) {
          executorConfig.hooks.beforeMigration = sharedHooks.beforeMigration;
        }
        if (sharedHooks.afterApply) {
          executorConfig.hooks.afterMigration = sharedHooks.afterApply;
        }
      }

      this.sharedMigrationExecutor = new SharedMigrationExecutor(
        executorConfig,
        {
          createPool: this.schemaManager.createRootPool.bind(this.schemaManager),
          // Use wrapper to check correct shared migrations table (not tenant migrations table)
          migrationsTableExists: async (pool: Pool, schemaName: string) => {
            const result = await pool.query(
              `SELECT 1 FROM information_schema.tables
               WHERE table_schema = $1 AND table_name = $2`,
              [schemaName, sharedMigrationsTable]
            );
            return result.rowCount !== null && result.rowCount > 0;
          },
          ensureMigrationsTable: this.schemaManager.ensureMigrationsTable.bind(this.schemaManager),
          getOrDetectFormat: this.getOrDetectSharedFormat.bind(this),
          loadMigrations: this.loadSharedMigrations.bind(this),
        }
      );
    } else {
      this.sharedMigrationExecutor = null;
    }

    // Initialize SharedSeeder (if shared schema is configured)
    if (tenantConfig.schemas.shared) {
      this.sharedSeeder = new SharedSeeder(
        { schemaName: 'public' },
        {
          createPool: this.schemaManager.createRootPool.bind(this.schemaManager),
          sharedSchema: tenantConfig.schemas.shared as TSharedSchema,
        }
      );
    } else {
      this.sharedSeeder = null;
    }
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
   * Clone a tenant to a new tenant
   *
   * By default, clones only schema structure. Use includeData to copy data.
   *
   * @example
   * ```typescript
   * // Schema-only clone
   * await migrator.cloneTenant('production', 'dev');
   *
   * // Clone with data
   * await migrator.cloneTenant('production', 'dev', { includeData: true });
   *
   * // Clone with anonymization
   * await migrator.cloneTenant('production', 'dev', {
   *   includeData: true,
   *   anonymize: {
   *     enabled: true,
   *     rules: {
   *       users: { email: null, phone: null },
   *     },
   *   },
   * });
   * ```
   */
  async cloneTenant(
    sourceTenantId: string,
    targetTenantId: string,
    options: CloneTenantOptions = {}
  ): Promise<CloneTenantResult> {
    return this.cloner.cloneTenant(sourceTenantId, targetTenantId, options);
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

  // ============================================================================
  // Shared Schema Seeding Methods (delegated to SharedSeeder)
  // ============================================================================

  /**
   * Check if shared schema seeding is available
   *
   * @returns True if shared schema is configured
   */
  hasSharedSeeding(): boolean {
    return this.sharedSeeder !== null;
  }

  /**
   * Seed the shared schema with initial data
   *
   * Seeds the public/shared schema with common data like plans, roles, permissions.
   * Must have schemas.shared configured in the tenant config.
   *
   * @example
   * ```typescript
   * if (migrator.hasSharedSeeding()) {
   *   const result = await migrator.seedShared(async (db) => {
   *     await db.insert(plans).values([
   *       { id: 'free', name: 'Free', price: 0 },
   *       { id: 'pro', name: 'Pro', price: 29 },
   *       { id: 'enterprise', name: 'Enterprise', price: 99 },
   *     ]).onConflictDoNothing();
   *
   *     await db.insert(roles).values([
   *       { name: 'admin', permissions: ['*'] },
   *       { name: 'user', permissions: ['read'] },
   *     ]).onConflictDoNothing();
   *   });
   *
   *   if (result.success) {
   *     console.log(`Seeded shared schema in ${result.durationMs}ms`);
   *   }
   * }
   * ```
   */
  async seedShared(seedFn: SharedSeedFunction<TSharedSchema>): Promise<SharedSeedResult> {
    if (!this.sharedSeeder) {
      return {
        schemaName: 'public',
        success: false,
        error: 'Shared schema not configured. Set schemas.shared in tenant config.',
        durationMs: 0,
      };
    }

    return this.sharedSeeder.seed(seedFn);
  }

  /**
   * Seed shared schema first, then all tenants
   *
   * Convenience method for the common pattern of seeding shared tables
   * before tenant tables.
   *
   * @example
   * ```typescript
   * const result = await migrator.seedAllWithShared(
   *   async (db) => {
   *     await db.insert(plans).values([{ id: 'free', name: 'Free' }]);
   *   },
   *   async (db, tenantId) => {
   *     await db.insert(roles).values([{ name: 'admin' }]);
   *   },
   *   { concurrency: 10 }
   * );
   *
   * if (result.shared.success) {
   *   console.log('Shared seeding completed');
   * }
   * console.log(`Tenants: ${result.tenants.succeeded}/${result.tenants.total}`);
   * ```
   */
  async seedAllWithShared(
    sharedSeedFn: SharedSeedFunction<TSharedSchema>,
    tenantSeedFn: SeedFunction<TTenantSchema>,
    options: SeedOptions = {}
  ): Promise<{ shared: SharedSeedResult; tenants: SeedResults }> {
    // First seed shared schema
    const sharedResult = await this.seedShared(sharedSeedFn);

    // Then seed all tenants
    const tenantsResult = await this.seedAll(tenantSeedFn, options);

    return {
      shared: sharedResult,
      tenants: tenantsResult,
    };
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

  /**
   * Load shared migration files from the shared migrations folder
   */
  private async loadSharedMigrations(): Promise<MigrationFile[]> {
    if (!this.migratorConfig.sharedMigrationsFolder) {
      return [];
    }

    const files = await readdir(this.migratorConfig.sharedMigrationsFolder);
    const migrations: MigrationFile[] = [];

    for (const file of files) {
      if (!file.endsWith('.sql')) continue;

      const filePath = join(this.migratorConfig.sharedMigrationsFolder, file);
      const content = await readFile(filePath, 'utf-8');

      const match = file.match(/^(\d+)_/);
      const timestamp = match?.[1] ? parseInt(match[1], 10) : 0;

      const hash = createHash('sha256').update(content).digest('hex');

      migrations.push({
        name: basename(file, '.sql'),
        path: filePath,
        sql: content,
        timestamp,
        hash,
      });
    }

    return migrations.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get or detect the format for the shared schema
   *
   * Uses sharedTableFormat/sharedDefaultFormat if configured,
   * otherwise falls back to tableFormat/defaultFormat for backwards compatibility.
   */
  private async getOrDetectSharedFormat(
    pool: Pool,
    schemaName: string
  ): Promise<DetectedFormat> {
    const sharedMigrationsTable = this.migratorConfig.sharedMigrationsTable ?? DEFAULT_SHARED_MIGRATIONS_TABLE;

    // Use sharedTableFormat if specified, otherwise fall back to tableFormat for backwards compatibility
    const configuredFormat = this.migratorConfig.sharedTableFormat ?? this.migratorConfig.tableFormat ?? 'auto';

    if (configuredFormat !== 'auto') {
      return getFormatConfig(configuredFormat, sharedMigrationsTable);
    }

    const detected = await detectTableFormat(pool, schemaName, sharedMigrationsTable);

    if (detected) {
      return detected;
    }

    // Use sharedDefaultFormat if specified, otherwise fall back to defaultFormat
    const defaultFormat: TableFormat = this.migratorConfig.sharedDefaultFormat ?? this.migratorConfig.defaultFormat ?? 'name';
    return getFormatConfig(defaultFormat, sharedMigrationsTable);
  }

  // ============================================================================
  // Shared Schema Migration Methods
  // ============================================================================

  /**
   * Check if shared schema migrations are configured
   *
   * @returns True if sharedMigrationsFolder is configured and exists
   */
  hasSharedMigrations(): boolean {
    return this.sharedMigrationExecutor !== null;
  }

  /**
   * Migrate the shared schema (public)
   *
   * Applies pending migrations to the shared/public schema.
   * Must have sharedMigrationsFolder configured.
   *
   * @example
   * ```typescript
   * if (migrator.hasSharedMigrations()) {
   *   const result = await migrator.migrateShared();
   *   console.log(`Applied ${result.appliedMigrations.length} shared migrations`);
   * }
   * ```
   */
  async migrateShared(options: SharedMigrateOptions = {}): Promise<SharedMigrationResult> {
    if (!this.sharedMigrationExecutor) {
      return {
        schemaName: 'public',
        success: false,
        appliedMigrations: [],
        error: 'Shared migrations not configured. Set sharedMigrationsFolder in migrator config.',
        durationMs: 0,
      };
    }

    return this.sharedMigrationExecutor.migrate(options);
  }

  /**
   * Get migration status for the shared schema
   *
   * @returns Status with applied/pending counts
   */
  async getSharedStatus(): Promise<SharedMigrationStatus> {
    if (!this.sharedMigrationExecutor) {
      return {
        schemaName: 'public',
        appliedCount: 0,
        pendingCount: 0,
        pendingMigrations: [],
        status: 'error',
        error: 'Shared migrations not configured. Set sharedMigrationsFolder in migrator config.',
        format: null,
      };
    }

    return this.sharedMigrationExecutor.getStatus();
  }

  /**
   * Mark shared schema migrations as applied without executing SQL
   *
   * Useful for syncing tracking state with already-applied migrations.
   */
  async markSharedAsApplied(
    options: { onProgress?: SharedMigrateOptions['onProgress'] } = {}
  ): Promise<SharedMigrationResult> {
    if (!this.sharedMigrationExecutor) {
      return {
        schemaName: 'public',
        success: false,
        appliedMigrations: [],
        error: 'Shared migrations not configured. Set sharedMigrationsFolder in migrator config.',
        durationMs: 0,
      };
    }

    return this.sharedMigrationExecutor.markAsApplied(options);
  }

  /**
   * Migrate shared schema first, then all tenants
   *
   * Convenience method for the common pattern of migrating shared tables
   * before tenant tables.
   *
   * @example
   * ```typescript
   * const result = await migrator.migrateAllWithShared({
   *   concurrency: 10,
   *   onProgress: (tenantId, status) => console.log(`${tenantId}: ${status}`),
   * });
   *
   * console.log(`Shared: ${result.shared.appliedMigrations.length} applied`);
   * console.log(`Tenants: ${result.tenants.succeeded}/${result.tenants.total} succeeded`);
   * ```
   */
  async migrateAllWithShared(
    options: MigrateOptions & { sharedOptions?: SharedMigrateOptions } = {}
  ): Promise<{ shared: SharedMigrationResult; tenants: MigrationResults }> {
    const { sharedOptions, ...tenantOptions } = options;

    // First migrate shared schema
    const sharedResult = await this.migrateShared(sharedOptions ?? {});

    // Then migrate all tenants
    const tenantsResult = await this.migrateAll(tenantOptions);

    return {
      shared: sharedResult,
      tenants: tenantsResult,
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
