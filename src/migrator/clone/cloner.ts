/**
 * Cloner
 *
 * Clones a tenant to another, including structure and optionally data.
 *
 * @module clone/cloner
 */

import type { Pool } from 'pg';
import type {
  ClonerConfig,
  ClonerDependencies,
  CloneTenantOptions,
  CloneTenantResult,
} from './types.js';
import { listTables, generateTableCloneInfo } from './ddl-generator.js';
import { copyAllData } from './data-copier.js';

const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Clones tenants with support for introspection + DDL
 *
 * @example
 * ```typescript
 * const cloner = createCloner(config, dependencies);
 *
 * // Schema-only clone
 * await cloner.cloneTenant('source', 'target');
 *
 * // Clone with data
 * await cloner.cloneTenant('source', 'target', { includeData: true });
 *
 * // Clone with anonymization
 * await cloner.cloneTenant('source', 'target', {
 *   includeData: true,
 *   anonymize: {
 *     enabled: true,
 *     rules: { users: { email: null, phone: null } },
 *   },
 * });
 * ```
 */
export class Cloner {
  private readonly migrationsTable: string;

  constructor(
    config: ClonerConfig,
    private readonly deps: ClonerDependencies
  ) {
    this.migrationsTable = config.migrationsTable ?? DEFAULT_MIGRATIONS_TABLE;
  }

  /**
   * Clone a tenant to another
   *
   * @param sourceTenantId - Source tenant ID
   * @param targetTenantId - Target tenant ID
   * @param options - Clone options
   * @returns Clone result
   */
  async cloneTenant(
    sourceTenantId: string,
    targetTenantId: string,
    options: CloneTenantOptions = {}
  ): Promise<CloneTenantResult> {
    const startTime = Date.now();
    const {
      includeData = false,
      anonymize,
      excludeTables = [],
      onProgress,
    } = options;

    const sourceSchema = this.deps.schemaNameTemplate(sourceTenantId);
    const targetSchema = this.deps.schemaNameTemplate(targetTenantId);

    // Tables to exclude: migrations + custom
    const allExcludes = [this.migrationsTable, ...excludeTables];

    let sourcePool: Pool | null = null;
    let rootPool: Pool | null = null;

    try {
      onProgress?.('starting');

      // Check if source exists
      const sourceExists = await this.deps.schemaExists(sourceTenantId);
      if (!sourceExists) {
        return this.createErrorResult(
          sourceTenantId,
          targetTenantId,
          targetSchema,
          `Source tenant "${sourceTenantId}" does not exist`,
          startTime
        );
      }

      // Check if target already exists
      const targetExists = await this.deps.schemaExists(targetTenantId);
      if (targetExists) {
        return this.createErrorResult(
          sourceTenantId,
          targetTenantId,
          targetSchema,
          `Target tenant "${targetTenantId}" already exists`,
          startTime
        );
      }

      // Introspect source schema
      onProgress?.('introspecting');
      sourcePool = await this.deps.createPool(sourceSchema);

      const tables = await listTables(sourcePool, sourceSchema, allExcludes);

      if (tables.length === 0) {
        // Source has no tables, just create empty schema
        onProgress?.('creating_schema');
        await this.deps.createSchema(targetTenantId);

        onProgress?.('completed');
        return {
          sourceTenant: sourceTenantId,
          targetTenant: targetTenantId,
          targetSchema,
          success: true,
          tables: [],
          durationMs: Date.now() - startTime,
        };
      }

      const tableInfos = await Promise.all(
        tables.map((t) => generateTableCloneInfo(sourcePool!, sourceSchema, targetSchema, t))
      );

      // Close source pool after introspection
      await sourcePool.end();
      sourcePool = null;

      // Create target schema
      onProgress?.('creating_schema');
      await this.deps.createSchema(targetTenantId);

      // Execute DDLs on target
      rootPool = await this.deps.createRootPool();

      // Create tables
      onProgress?.('creating_tables');
      for (const info of tableInfos) {
        await rootPool.query(`SET search_path TO "${targetSchema}"; ${info.createDdl}`);
      }

      // Create PKs and Unique constraints (before FK)
      onProgress?.('creating_constraints');
      for (const info of tableInfos) {
        for (const constraint of info.constraintDdls.filter((c) => !c.includes('FOREIGN KEY'))) {
          try {
            await rootPool.query(`SET search_path TO "${targetSchema}"; ${constraint}`);
          } catch (error) {
            // Constraint might already exist due to table definition
            // This can happen with some PostgreSQL versions
          }
        }
      }

      // Create indexes
      onProgress?.('creating_indexes');
      for (const info of tableInfos) {
        for (const index of info.indexDdls) {
          try {
            await rootPool.query(index);
          } catch (error) {
            // Index might already exist
          }
        }
      }

      // Copy data if requested
      let rowsCopied = 0;
      if (includeData) {
        onProgress?.('copying_data');
        rowsCopied = await copyAllData(
          rootPool,
          sourceSchema,
          targetSchema,
          tables,
          anonymize?.enabled ? anonymize.rules : undefined,
          onProgress
        );
      }

      // Create FKs (after data)
      for (const info of tableInfos) {
        for (const fk of info.constraintDdls.filter((c) => c.includes('FOREIGN KEY'))) {
          try {
            await rootPool.query(fk);
          } catch (error) {
            // FK might fail if referencing tables outside the tenant schema
            // Log but don't fail the entire operation
          }
        }
      }

      onProgress?.('completed');

      const result: CloneTenantResult = {
        sourceTenant: sourceTenantId,
        targetTenant: targetTenantId,
        targetSchema,
        success: true,
        tables,
        durationMs: Date.now() - startTime,
      };

      if (includeData) {
        result.rowsCopied = rowsCopied;
      }

      return result;
    } catch (error) {
      options.onError?.(error as Error);
      onProgress?.('failed');

      return this.createErrorResult(
        sourceTenantId,
        targetTenantId,
        targetSchema,
        (error as Error).message,
        startTime
      );
    } finally {
      // Cleanup pools
      if (sourcePool) {
        await sourcePool.end().catch(() => {});
      }
      if (rootPool) {
        await rootPool.end().catch(() => {});
      }
    }
  }

  private createErrorResult(
    source: string,
    target: string,
    schema: string,
    error: string,
    startTime: number
  ): CloneTenantResult {
    return {
      sourceTenant: source,
      targetTenant: target,
      targetSchema: schema,
      success: false,
      error,
      tables: [],
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Factory function for Cloner
 *
 * @param config - Cloner configuration
 * @param dependencies - Cloner dependencies
 * @returns Cloner instance
 */
export function createCloner(config: ClonerConfig, dependencies: ClonerDependencies): Cloner {
  return new Cloner(config, dependencies);
}
