/**
 * Drift Detector
 *
 * Detects schema drift between tenant databases by comparing their structures.
 * Identifies differences in tables, columns, indexes, and constraints.
 *
 * Extracted from Migrator to follow Single Responsibility Principle.
 *
 * @module drift/drift-detector
 */

import type { Pool } from 'pg';
import type { Config } from '../../types.js';
import type { SchemaManager } from '../schema-manager.js';
import type {
  TenantSchema,
  TableSchema,
  TenantSchemaDrift,
  SchemaDriftStatus,
  SchemaDriftOptions,
  TableDrift,
  IntrospectOptions,
} from './types.js';
import { introspectColumns, compareColumns } from './column-analyzer.js';
import { introspectIndexes, compareIndexes } from './index-analyzer.js';
import { introspectConstraints, compareConstraints } from './constraint-analyzer.js';

const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Configuration options for DriftDetector
 */
export interface DriftDetectorConfig {
  /** Migrations table name to exclude from comparisons */
  migrationsTable?: string;
  /** Function to discover tenant IDs */
  tenantDiscovery: () => Promise<string[]>;
}

/**
 * Detects schema drift between tenant databases.
 *
 * Schema drift occurs when tenant databases have structural differences
 * that shouldn't exist if all migrations were applied consistently.
 * This class helps identify such inconsistencies by comparing schemas.
 *
 * @example
 * ```typescript
 * const detector = new DriftDetector(config, schemaManager, {
 *   migrationsTable: '__drizzle_migrations',
 *   tenantDiscovery: async () => ['tenant-1', 'tenant-2', 'tenant-3'],
 * });
 *
 * // Detect drift across all tenants
 * const status = await detector.detectDrift();
 * if (status.withDrift > 0) {
 *   console.log('Schema drift detected!');
 *   for (const tenant of status.details) {
 *     if (tenant.hasDrift) {
 *       console.log(`Tenant ${tenant.tenantId}:`);
 *       for (const table of tenant.tables) {
 *         console.log(`  Table ${table.table}: ${table.status}`);
 *       }
 *     }
 *   }
 * }
 * ```
 */
export class DriftDetector<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
> {
  private readonly migrationsTable: string;

  constructor(
    private readonly tenantConfig: Config<TTenantSchema, TSharedSchema>,
    private readonly schemaManager: SchemaManager<TTenantSchema, TSharedSchema>,
    private readonly driftConfig: DriftDetectorConfig
  ) {
    this.migrationsTable = driftConfig.migrationsTable ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /**
   * Get the schema name for a tenant ID
   */
  private getSchemaName(tenantId: string): string {
    return this.tenantConfig.isolation.schemaNameTemplate(tenantId);
  }

  /**
   * Create a pool for a schema
   */
  private async createPool(schemaName: string): Promise<Pool> {
    return this.schemaManager.createPool(schemaName);
  }

  /**
   * Detect schema drift across all tenants.
   *
   * Compares each tenant's schema against a reference tenant (first tenant by default).
   * Returns a comprehensive report of all differences found.
   *
   * @param options - Detection options
   * @returns Schema drift status with details for each tenant
   *
   * @example
   * ```typescript
   * // Basic usage - compare all tenants against the first one
   * const status = await detector.detectDrift();
   *
   * // Use a specific tenant as reference
   * const status = await detector.detectDrift({
   *   referenceTenant: 'golden-tenant',
   * });
   *
   * // Check specific tenants only
   * const status = await detector.detectDrift({
   *   tenantIds: ['tenant-1', 'tenant-2'],
   * });
   *
   * // Skip index and constraint comparison for faster checks
   * const status = await detector.detectDrift({
   *   includeIndexes: false,
   *   includeConstraints: false,
   * });
   * ```
   */
  async detectDrift(options: SchemaDriftOptions = {}): Promise<SchemaDriftStatus> {
    const startTime = Date.now();
    const {
      concurrency = 10,
      includeIndexes = true,
      includeConstraints = true,
      excludeTables = [this.migrationsTable],
      onProgress,
    } = options;

    // Get tenant IDs to check
    const tenantIds = options.tenantIds ?? (await this.driftConfig.tenantDiscovery());

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

    const referenceSchema = await this.introspectSchema(referenceTenant, {
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
          schemaName: this.getSchemaName(id),
          hasDrift: false,
          tables: [],
          issueCount: 0,
          error:
            id === referenceTenant
              ? 'Failed to introspect reference tenant'
              : 'Reference tenant introspection failed',
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

            const tenantSchema = await this.introspectSchema(tenantId, {
              includeIndexes,
              includeConstraints,
              excludeTables,
            });

            if (!tenantSchema) {
              onProgress?.(tenantId, 'failed');
              return {
                tenantId,
                schemaName: this.getSchemaName(tenantId),
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
              schemaName: this.getSchemaName(tenantId),
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
   * Compare a specific tenant against a reference tenant.
   *
   * @param tenantId - Tenant to check
   * @param referenceTenantId - Tenant to use as reference
   * @param options - Introspection options
   * @returns Drift details for the tenant
   *
   * @example
   * ```typescript
   * const drift = await detector.compareTenant('tenant-123', 'golden-tenant');
   * if (drift.hasDrift) {
   *   console.log(`Found ${drift.issueCount} issues`);
   * }
   * ```
   */
  async compareTenant(
    tenantId: string,
    referenceTenantId: string,
    options: IntrospectOptions = {}
  ): Promise<TenantSchemaDrift> {
    const {
      includeIndexes = true,
      includeConstraints = true,
      excludeTables = [this.migrationsTable],
    } = options;

    const referenceSchema = await this.introspectSchema(referenceTenantId, {
      includeIndexes,
      includeConstraints,
      excludeTables,
    });

    if (!referenceSchema) {
      return {
        tenantId,
        schemaName: this.getSchemaName(tenantId),
        hasDrift: false,
        tables: [],
        issueCount: 0,
        error: 'Failed to introspect reference tenant',
      };
    }

    const tenantSchema = await this.introspectSchema(tenantId, {
      includeIndexes,
      includeConstraints,
      excludeTables,
    });

    if (!tenantSchema) {
      return {
        tenantId,
        schemaName: this.getSchemaName(tenantId),
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
   * Introspect a tenant's schema structure.
   *
   * Retrieves all tables, columns, indexes, and constraints
   * for a tenant's schema.
   *
   * @param tenantId - Tenant to introspect
   * @param options - Introspection options
   * @returns Schema structure or null if introspection fails
   *
   * @example
   * ```typescript
   * const schema = await detector.introspectSchema('tenant-123');
   * if (schema) {
   *   console.log(`Found ${schema.tables.length} tables`);
   *   for (const table of schema.tables) {
   *     console.log(`  ${table.name}: ${table.columns.length} columns`);
   *   }
   * }
   * ```
   */
  async introspectSchema(
    tenantId: string,
    options: IntrospectOptions = {}
  ): Promise<TenantSchema | null> {
    const schemaName = this.getSchemaName(tenantId);
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
   * Compare two schema snapshots.
   *
   * This method compares pre-introspected schema snapshots,
   * useful when you already have the schema data available.
   *
   * @param reference - Reference (expected) schema
   * @param target - Target (actual) schema
   * @param options - Comparison options
   * @returns Drift details
   *
   * @example
   * ```typescript
   * const refSchema = await detector.introspectSchema('golden-tenant');
   * const targetSchema = await detector.introspectSchema('tenant-123');
   *
   * if (refSchema && targetSchema) {
   *   const drift = detector.compareSchemas(refSchema, targetSchema);
   *   console.log(`Drift detected: ${drift.hasDrift}`);
   * }
   * ```
   */
  compareSchemas(
    reference: TenantSchema,
    target: TenantSchema,
    options: Pick<IntrospectOptions, 'includeIndexes' | 'includeConstraints'> = {}
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
      const columnDrifts = compareColumns(refTable.columns, targetTable.columns);
      const indexDrifts = includeIndexes
        ? compareIndexes(refTable.indexes, targetTable.indexes)
        : [];
      const constraintDrifts = includeConstraints
        ? compareConstraints(refTable.constraints, targetTable.constraints)
        : [];

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
   * Introspect all tables in a schema
   */
  private async introspectTables(
    pool: Pool,
    schemaName: string,
    options: IntrospectOptions
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

      const columns = await introspectColumns(pool, schemaName, row.table_name);
      const indexes = includeIndexes
        ? await introspectIndexes(pool, schemaName, row.table_name)
        : [];
      const constraints = includeConstraints
        ? await introspectConstraints(pool, schemaName, row.table_name)
        : [];

      tables.push({
        name: row.table_name,
        columns,
        indexes,
        constraints,
      });
    }

    return tables;
  }
}

/**
 * Factory function to create a DriftDetector instance.
 *
 * @param config - Tenant configuration
 * @param schemaManager - Schema manager instance
 * @param driftConfig - Drift detector configuration
 * @returns A new DriftDetector instance
 *
 * @example
 * ```typescript
 * const detector = createDriftDetector(config, schemaManager, {
 *   migrationsTable: '__drizzle_migrations',
 *   tenantDiscovery: async () => db.select().from(tenants).then(t => t.map(x => x.id)),
 * });
 * ```
 */
export function createDriftDetector<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
>(
  config: Config<TTenantSchema, TSharedSchema>,
  schemaManager: SchemaManager<TTenantSchema, TSharedSchema>,
  driftConfig: DriftDetectorConfig
): DriftDetector<TTenantSchema, TSharedSchema> {
  return new DriftDetector(config, schemaManager, driftConfig);
}
