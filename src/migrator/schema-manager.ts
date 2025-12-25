import { Pool } from 'pg';
import type { Config } from '../types.js';
import type { DetectedFormat } from './table-format.js';

const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Options for creating a tenant schema
 */
export interface CreateSchemaOptions {
  /** Whether to also run migrations after creating (handled by Migrator) */
  migrate?: boolean;
}

/**
 * Options for dropping a tenant schema
 */
export interface DropSchemaOptions {
  /** Use CASCADE to drop all objects in schema */
  cascade?: boolean;
  /** Force drop without confirmation (used by CLI) */
  force?: boolean;
}

/**
 * Manages PostgreSQL schema lifecycle for multi-tenant applications.
 *
 * Extracted from Migrator to follow Single Responsibility Principle.
 * Handles schema creation, deletion, existence checks, and migrations table management.
 *
 * @example
 * ```typescript
 * const schemaManager = new SchemaManager(config);
 *
 * // Create a new tenant schema
 * await schemaManager.createSchema('tenant-123');
 *
 * // Check if schema exists
 * const exists = await schemaManager.schemaExists('tenant-123');
 *
 * // Drop a tenant schema
 * await schemaManager.dropSchema('tenant-123', { cascade: true });
 * ```
 */
export class SchemaManager<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
> {
  private readonly migrationsTable: string;

  constructor(
    private readonly config: Config<TTenantSchema, TSharedSchema>,
    migrationsTable?: string
  ) {
    this.migrationsTable = migrationsTable ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /**
   * Get the schema name for a tenant ID using the configured template
   *
   * @param tenantId - The tenant identifier
   * @returns The PostgreSQL schema name
   *
   * @example
   * ```typescript
   * const schemaName = schemaManager.getSchemaName('tenant-123');
   * // Returns: 'tenant_tenant-123' (depends on schemaNameTemplate)
   * ```
   */
  getSchemaName(tenantId: string): string {
    return this.config.isolation.schemaNameTemplate(tenantId);
  }

  /**
   * Create a PostgreSQL pool for a specific schema
   *
   * The pool is configured with `search_path` set to the schema,
   * allowing queries to run in tenant isolation.
   *
   * @param schemaName - The PostgreSQL schema name
   * @returns A configured Pool instance
   *
   * @example
   * ```typescript
   * const pool = await schemaManager.createPool('tenant_123');
   * try {
   *   await pool.query('SELECT * FROM users'); // Queries tenant_123.users
   * } finally {
   *   await pool.end();
   * }
   * ```
   */
  async createPool(schemaName: string): Promise<Pool> {
    return new Pool({
      connectionString: this.config.connection.url,
      ...this.config.connection.poolConfig,
      options: `-c search_path="${schemaName}",public`,
    });
  }

  /**
   * Create a PostgreSQL pool without schema-specific search_path
   *
   * Used for operations that need to work across schemas or
   * before a schema exists (like creating the schema itself).
   *
   * @returns A Pool instance connected to the database
   */
  async createRootPool(): Promise<Pool> {
    return new Pool({
      connectionString: this.config.connection.url,
      ...this.config.connection.poolConfig,
    });
  }

  /**
   * Create a new tenant schema in the database
   *
   * @param tenantId - The tenant identifier
   * @returns Promise that resolves when schema is created
   *
   * @example
   * ```typescript
   * await schemaManager.createSchema('new-tenant');
   * ```
   */
  async createSchema(tenantId: string): Promise<void> {
    const schemaName = this.getSchemaName(tenantId);
    const pool = await this.createRootPool();

    try {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    } finally {
      await pool.end();
    }
  }

  /**
   * Drop a tenant schema from the database
   *
   * @param tenantId - The tenant identifier
   * @param options - Drop options (cascade, force)
   * @returns Promise that resolves when schema is dropped
   *
   * @example
   * ```typescript
   * // Drop with CASCADE (removes all objects)
   * await schemaManager.dropSchema('old-tenant', { cascade: true });
   *
   * // Drop with RESTRICT (fails if objects exist)
   * await schemaManager.dropSchema('old-tenant', { cascade: false });
   * ```
   */
  async dropSchema(tenantId: string, options: DropSchemaOptions = {}): Promise<void> {
    const { cascade = true } = options;
    const schemaName = this.getSchemaName(tenantId);
    const pool = await this.createRootPool();

    try {
      const cascadeSql = cascade ? 'CASCADE' : 'RESTRICT';
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" ${cascadeSql}`);
    } finally {
      await pool.end();
    }
  }

  /**
   * Check if a tenant schema exists in the database
   *
   * @param tenantId - The tenant identifier
   * @returns True if schema exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await schemaManager.schemaExists('tenant-123')) {
   *   console.log('Tenant schema exists');
   * }
   * ```
   */
  async schemaExists(tenantId: string): Promise<boolean> {
    const schemaName = this.getSchemaName(tenantId);
    const pool = await this.createRootPool();

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
   * List all schemas matching a pattern
   *
   * @param pattern - SQL LIKE pattern to filter schemas (optional)
   * @returns Array of schema names
   *
   * @example
   * ```typescript
   * // List all tenant schemas
   * const schemas = await schemaManager.listSchemas('tenant_%');
   * ```
   */
  async listSchemas(pattern?: string): Promise<string[]> {
    const pool = await this.createRootPool();

    try {
      const query = pattern
        ? `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE $1 ORDER BY schema_name`
        : `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY schema_name`;

      const result = await pool.query<{ schema_name: string }>(
        query,
        pattern ? [pattern] : []
      );

      return result.rows.map((row) => row.schema_name);
    } finally {
      await pool.end();
    }
  }

  /**
   * Ensure the migrations table exists with the correct format
   *
   * Creates the migrations tracking table if it doesn't exist,
   * using the appropriate column types based on the format.
   *
   * @param pool - Database pool to use
   * @param schemaName - The schema to create the table in
   * @param format - The detected/configured table format
   *
   * @example
   * ```typescript
   * const pool = await schemaManager.createPool('tenant_123');
   * await schemaManager.ensureMigrationsTable(pool, 'tenant_123', format);
   * ```
   */
  async ensureMigrationsTable(
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
   * Check if the migrations table exists in a schema
   *
   * @param pool - Database pool to use
   * @param schemaName - The schema to check
   * @returns True if migrations table exists
   *
   * @example
   * ```typescript
   * const pool = await schemaManager.createPool('tenant_123');
   * if (await schemaManager.migrationsTableExists(pool, 'tenant_123')) {
   *   console.log('Migrations table exists');
   * }
   * ```
   */
  async migrationsTableExists(pool: Pool, schemaName: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2`,
      [schemaName, this.migrationsTable]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Get the configured migrations table name
   *
   * @returns The migrations table name
   */
  getMigrationsTableName(): string {
    return this.migrationsTable;
  }
}

/**
 * Factory function to create a SchemaManager instance
 *
 * @param config - The tenant configuration
 * @param migrationsTable - Optional custom migrations table name
 * @returns A new SchemaManager instance
 *
 * @example
 * ```typescript
 * const schemaManager = createSchemaManager(config);
 * await schemaManager.createSchema('tenant-123');
 * ```
 */
export function createSchemaManager<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
>(
  config: Config<TTenantSchema, TSharedSchema>,
  migrationsTable?: string
): SchemaManager<TTenantSchema, TSharedSchema> {
  return new SchemaManager(config, migrationsTable);
}
