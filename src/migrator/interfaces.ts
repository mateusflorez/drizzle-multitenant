/**
 * Interfaces for Migrator module refactoring
 *
 * These interfaces define the contracts for the extracted modules.
 * They should be implemented when refactoring the god component.
 *
 * @see REFACTOR_PROPOSAL.md for full refactoring plan
 */

import type { Pool } from 'pg';
import type {
  MigrationFile,
  TenantMigrationResult,
  MigrationResults,
  TenantMigrationStatus,
  TenantSyncStatus,
  SyncStatus,
  TenantSyncResult,
  SyncResults,
  TenantSeedResult,
  SeedResults,
  SeedFunction,
  TenantSchemaDrift,
  SchemaDriftStatus,
  TenantSchema,
  MigrateOptions,
  SyncOptions,
  SeedOptions,
  SchemaDriftOptions,
  CreateTenantOptions,
  DropTenantOptions,
  MigrationHooks,
} from './types.js';
import type { DetectedFormat } from './table-format.js';

// ============================================================================
// Migration Executor Interfaces
// ============================================================================

/**
 * Options for executing a single migration
 */
export interface ExecuteMigrationOptions {
  /** Whether to skip actual SQL execution (mark as applied only) */
  markOnly?: boolean;
  /** Progress callback */
  onProgress?: (status: 'applying' | 'recording') => void;
}

/**
 * Responsible for executing migrations on a single tenant
 */
export interface IMigrationExecutor {
  /**
   * Execute a single migration on a tenant
   */
  executeMigration(
    pool: Pool,
    schemaName: string,
    migration: MigrationFile,
    format: DetectedFormat,
    options?: ExecuteMigrationOptions
  ): Promise<void>;

  /**
   * Execute multiple migrations on a tenant
   */
  executeMigrations(
    pool: Pool,
    schemaName: string,
    migrations: MigrationFile[],
    format: DetectedFormat,
    options?: ExecuteMigrationOptions
  ): Promise<string[]>;

  /**
   * Record a migration as applied without executing SQL
   */
  recordMigration(
    pool: Pool,
    schemaName: string,
    migration: MigrationFile,
    format: DetectedFormat
  ): Promise<void>;

  /**
   * Get list of applied migrations for a tenant
   */
  getAppliedMigrations(
    pool: Pool,
    schemaName: string,
    format: DetectedFormat
  ): Promise<Array<{ identifier: string; name?: string; hash?: string; appliedAt: Date }>>;

  /**
   * Get pending migrations (not yet applied)
   */
  getPendingMigrations(
    pool: Pool,
    schemaName: string,
    allMigrations: MigrationFile[],
    format: DetectedFormat
  ): Promise<MigrationFile[]>;
}

// ============================================================================
// Batch Executor Interfaces
// ============================================================================

/**
 * Batch execution options
 */
export interface BatchExecuteOptions extends MigrateOptions {
  /** Migrations to apply (if not provided, loads from disk) */
  migrations?: MigrationFile[];
}

/**
 * Responsible for batch migration operations across multiple tenants
 */
export interface IBatchExecutor {
  /**
   * Migrate all tenants in parallel
   */
  migrateAll(options?: BatchExecuteOptions): Promise<MigrationResults>;

  /**
   * Migrate specific tenants in parallel
   */
  migrateTenants(tenantIds: string[], options?: BatchExecuteOptions): Promise<MigrationResults>;

  /**
   * Mark all tenants as applied without executing SQL
   */
  markAllAsApplied(options?: MigrateOptions): Promise<MigrationResults>;
}

// ============================================================================
// Schema Manager Interfaces
// ============================================================================

/**
 * Responsible for schema lifecycle operations
 */
export interface ISchemaManager {
  /**
   * Create a new tenant schema
   */
  createSchema(tenantId: string, options?: CreateTenantOptions): Promise<void>;

  /**
   * Drop a tenant schema
   */
  dropSchema(tenantId: string, options?: DropTenantOptions): Promise<void>;

  /**
   * Check if a tenant schema exists
   */
  schemaExists(tenantId: string): Promise<boolean>;

  /**
   * List all tenant schemas matching pattern
   */
  listSchemas(pattern?: string): Promise<string[]>;

  /**
   * Get the schema name for a tenant ID
   */
  getSchemaName(tenantId: string): string;

  /**
   * Ensure migrations table exists in schema
   */
  ensureMigrationsTable(
    pool: Pool,
    schemaName: string,
    format: DetectedFormat
  ): Promise<void>;

  /**
   * Check if migrations table exists
   */
  migrationsTableExists(pool: Pool, schemaName: string): Promise<boolean>;
}

// ============================================================================
// Sync Manager Interfaces
// ============================================================================

/**
 * Responsible for synchronizing migration state between disk and database
 */
export interface ISyncManager {
  /**
   * Get sync status for all tenants
   */
  getSyncStatus(): Promise<SyncStatus>;

  /**
   * Get sync status for a specific tenant
   */
  getTenantSyncStatus(tenantId: string, migrations?: MigrationFile[]): Promise<TenantSyncStatus>;

  /**
   * Mark missing migrations as applied for a tenant
   */
  markMissing(tenantId: string): Promise<TenantSyncResult>;

  /**
   * Mark missing migrations as applied for all tenants
   */
  markAllMissing(options?: SyncOptions): Promise<SyncResults>;

  /**
   * Remove orphan records from a tenant
   */
  cleanOrphans(tenantId: string): Promise<TenantSyncResult>;

  /**
   * Remove orphan records from all tenants
   */
  cleanAllOrphans(options?: SyncOptions): Promise<SyncResults>;
}

// ============================================================================
// Drift Detector Interfaces
// ============================================================================

/**
 * Options for introspecting a tenant schema
 */
export interface IntrospectOptions {
  /** Tables to exclude from introspection */
  excludeTables?: string[];
  /** Whether to include indexes */
  includeIndexes?: boolean;
  /** Whether to include constraints */
  includeConstraints?: boolean;
}

/**
 * Responsible for detecting schema drift between tenants
 */
export interface IDriftDetector {
  /**
   * Detect schema drift across all tenants
   */
  detectDrift(options?: SchemaDriftOptions): Promise<SchemaDriftStatus>;

  /**
   * Compare a tenant schema against a reference tenant
   */
  compareTenant(
    tenantId: string,
    referenceTenantId: string,
    options?: IntrospectOptions
  ): Promise<TenantSchemaDrift>;

  /**
   * Introspect a tenant's schema
   */
  introspectSchema(
    tenantId: string,
    options?: IntrospectOptions
  ): Promise<TenantSchema | null>;

  /**
   * Compare two schema snapshots
   */
  compareSchemas(
    reference: TenantSchema,
    target: TenantSchema,
    options?: IntrospectOptions
  ): TenantSchemaDrift;
}

// ============================================================================
// Seeder Interfaces
// ============================================================================

/**
 * Responsible for seeding tenant databases
 */
export interface ISeeder<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Seed a single tenant
   */
  seedTenant(tenantId: string, seedFn: SeedFunction<TSchema>): Promise<TenantSeedResult>;

  /**
   * Seed all tenants
   */
  seedAll(seedFn: SeedFunction<TSchema>, options?: SeedOptions): Promise<SeedResults>;

  /**
   * Seed specific tenants
   */
  seedTenants(
    tenantIds: string[],
    seedFn: SeedFunction<TSchema>,
    options?: SeedOptions
  ): Promise<SeedResults>;
}

// ============================================================================
// Migration File Loader Interfaces
// ============================================================================

/**
 * Responsible for loading migration files from disk
 */
export interface IMigrationLoader {
  /**
   * Load all migration files from the configured folder
   */
  loadMigrations(): Promise<MigrationFile[]>;

  /**
   * Load a specific migration file by name
   */
  loadMigration(name: string): Promise<MigrationFile | null>;

  /**
   * Get the configured migrations folder path
   */
  getMigrationsFolder(): string;

  /**
   * Compute hash for a migration file
   */
  computeHash(content: string): string;
}

// ============================================================================
// Tenant Status Interfaces
// ============================================================================

/**
 * Responsible for querying tenant migration status
 */
export interface ITenantStatus {
  /**
   * Get migration status for all tenants
   */
  getStatus(): Promise<TenantMigrationStatus[]>;

  /**
   * Get migration status for a specific tenant
   */
  getTenantStatus(tenantId: string): Promise<TenantMigrationStatus>;

  /**
   * Get all discovered tenant IDs
   */
  discoverTenants(): Promise<string[]>;
}

// ============================================================================
// Migrator Facade Interface
// ============================================================================

/**
 * Main Migrator interface (facade pattern)
 *
 * Delegates to internal modules while preserving the current public API.
 */
export interface IMigrator<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  // Migration operations
  migrateAll(options?: MigrateOptions): Promise<MigrationResults>;
  migrateTenant(tenantId: string, migrations?: MigrationFile[], options?: { dryRun?: boolean }): Promise<TenantMigrationResult>;
  migrateTenants(tenantIds: string[], options?: MigrateOptions): Promise<MigrationResults>;
  markAsApplied(tenantId: string): Promise<TenantMigrationResult>;
  markAllAsApplied(options?: MigrateOptions): Promise<MigrationResults>;

  // Status operations
  getStatus(): Promise<TenantMigrationStatus[]>;
  getTenantStatus(tenantId: string): Promise<TenantMigrationStatus>;

  // Tenant lifecycle
  createTenant(tenantId: string, options?: CreateTenantOptions): Promise<void>;
  dropTenant(tenantId: string, options?: DropTenantOptions): Promise<void>;
  tenantExists(tenantId: string): Promise<boolean>;

  // Sync operations
  getSyncStatus(): Promise<SyncStatus>;
  getTenantSyncStatus(tenantId: string, migrations?: MigrationFile[]): Promise<TenantSyncStatus>;
  markMissing(tenantId: string): Promise<TenantSyncResult>;
  markAllMissing(options?: SyncOptions): Promise<SyncResults>;
  cleanOrphans(tenantId: string): Promise<TenantSyncResult>;
  cleanAllOrphans(options?: SyncOptions): Promise<SyncResults>;

  // Drift detection
  getSchemaDrift(options?: SchemaDriftOptions): Promise<SchemaDriftStatus>;
  getTenantSchemaDrift(tenantId: string, referenceTenantId: string): Promise<TenantSchemaDrift>;
  introspectTenantSchema(tenantId: string, options?: IntrospectOptions): Promise<TenantSchema | null>;

  // Seeding
  seedTenant(tenantId: string, seedFn: SeedFunction<TTenantSchema>): Promise<TenantSeedResult>;
  seedAll(seedFn: SeedFunction<TTenantSchema>, options?: SeedOptions): Promise<SeedResults>;
  seedTenants(tenantIds: string[], seedFn: SeedFunction<TTenantSchema>, options?: SeedOptions): Promise<SeedResults>;
}

// ============================================================================
// Hook Manager Interface
// ============================================================================

/**
 * Manages lifecycle hooks for migration operations
 */
export interface IHookManager {
  /**
   * Register hooks
   */
  setHooks(hooks: MigrationHooks): void;

  /**
   * Emit before tenant hook
   */
  beforeTenant(tenantId: string): Promise<void>;

  /**
   * Emit after tenant hook
   */
  afterTenant(tenantId: string, result: TenantMigrationResult): Promise<void>;

  /**
   * Emit before migration hook
   */
  beforeMigration(tenantId: string, migrationName: string): Promise<void>;

  /**
   * Emit after migration hook
   */
  afterMigration(tenantId: string, migrationName: string, durationMs: number): Promise<void>;
}
