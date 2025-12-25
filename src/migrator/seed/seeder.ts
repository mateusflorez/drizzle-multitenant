import { drizzle } from 'drizzle-orm/node-postgres';
import type {
  SeedFunction,
  SeedOptions,
  TenantSeedResult,
  SeedResults,
} from '../types.js';
import type { ISeeder } from '../interfaces.js';
import type { SeederConfig, SeederDependencies } from './types.js';

/**
 * Responsible for seeding tenant databases with initial data.
 *
 * Extracted from Migrator to follow Single Responsibility Principle.
 * Handles seeding individual tenants and batch seeding operations.
 *
 * @example
 * ```typescript
 * const seeder = new Seeder(config, dependencies);
 *
 * // Seed a single tenant
 * const result = await seeder.seedTenant('tenant-123', async (db, tenantId) => {
 *   await db.insert(roles).values([
 *     { name: 'admin', permissions: ['*'] },
 *     { name: 'user', permissions: ['read'] },
 *   ]);
 * });
 *
 * // Seed all tenants
 * const results = await seeder.seedAll(seedFn, { concurrency: 10 });
 * ```
 */
export class Seeder<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
> implements ISeeder<TTenantSchema>
{
  constructor(
    private readonly config: SeederConfig,
    private readonly deps: SeederDependencies<TTenantSchema>
  ) {}

  /**
   * Seed a single tenant with initial data
   *
   * Creates a database connection for the tenant, executes the seed function,
   * and properly cleans up the connection afterward.
   *
   * @param tenantId - The tenant identifier
   * @param seedFn - Function that seeds the database
   * @returns Result of the seeding operation
   *
   * @example
   * ```typescript
   * const result = await seeder.seedTenant('tenant-123', async (db, tenantId) => {
   *   await db.insert(users).values([
   *     { name: 'Admin', email: `admin@${tenantId}.com` },
   *   ]);
   * });
   *
   * if (result.success) {
   *   console.log(`Seeded ${result.tenantId} in ${result.durationMs}ms`);
   * }
   * ```
   */
  async seedTenant(
    tenantId: string,
    seedFn: SeedFunction<TTenantSchema>
  ): Promise<TenantSeedResult> {
    const startTime = Date.now();
    const schemaName = this.deps.schemaNameTemplate(tenantId);

    const pool = await this.deps.createPool(schemaName);

    try {
      const db = drizzle(pool, {
        schema: this.deps.tenantSchema as TTenantSchema,
      });

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
   * Discovers all tenants and seeds them in batches with configurable concurrency.
   * Supports progress callbacks and abort-on-error behavior.
   *
   * @param seedFn - Function that seeds each database
   * @param options - Seeding options
   * @returns Aggregate results of all seeding operations
   *
   * @example
   * ```typescript
   * const results = await seeder.seedAll(
   *   async (db, tenantId) => {
   *     await db.insert(settings).values({ key: 'initialized', value: 'true' });
   *   },
   *   {
   *     concurrency: 5,
   *     onProgress: (id, status) => console.log(`${id}: ${status}`),
   *   }
   * );
   *
   * console.log(`Succeeded: ${results.succeeded}/${results.total}`);
   * ```
   */
  async seedAll(
    seedFn: SeedFunction<TTenantSchema>,
    options: SeedOptions = {}
  ): Promise<SeedResults> {
    const { concurrency = 10, onProgress, onError } = options;

    const tenantIds = await this.config.tenantDiscovery();
    const results: TenantSeedResult[] = [];
    let aborted = false;

    for (let i = 0; i < tenantIds.length && !aborted; i += concurrency) {
      const batch = tenantIds.slice(i, i + concurrency);

      const batchResults = await Promise.all(
        batch.map(async (tenantId) => {
          if (aborted) {
            return this.createSkippedResult(tenantId);
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
   * Seed specific tenants with initial data
   *
   * Seeds only the specified tenants in batches with configurable concurrency.
   *
   * @param tenantIds - List of tenant IDs to seed
   * @param seedFn - Function that seeds each database
   * @param options - Seeding options
   * @returns Aggregate results of seeding operations
   *
   * @example
   * ```typescript
   * const results = await seeder.seedTenants(
   *   ['tenant-1', 'tenant-2', 'tenant-3'],
   *   async (db) => {
   *     await db.insert(config).values({ setup: true });
   *   },
   *   { concurrency: 2 }
   * );
   * ```
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
            return this.createErrorResult(tenantId, error as Error);
          }
        })
      );

      results.push(...batchResults);
    }

    return this.aggregateResults(results);
  }

  /**
   * Create a skipped result for aborted seeding
   */
  private createSkippedResult(tenantId: string): TenantSeedResult {
    return {
      tenantId,
      schemaName: this.deps.schemaNameTemplate(tenantId),
      success: false,
      error: 'Skipped due to abort',
      durationMs: 0,
    };
  }

  /**
   * Create an error result for failed seeding
   */
  private createErrorResult(tenantId: string, error: Error): TenantSeedResult {
    return {
      tenantId,
      schemaName: this.deps.schemaNameTemplate(tenantId),
      success: false,
      error: error.message,
      durationMs: 0,
    };
  }

  /**
   * Aggregate individual results into a summary
   */
  private aggregateResults(results: TenantSeedResult[]): SeedResults {
    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter(
        (r) => !r.success && r.error !== 'Skipped due to abort'
      ).length,
      skipped: results.filter((r) => r.error === 'Skipped due to abort').length,
      details: results,
    };
  }
}

/**
 * Factory function to create a Seeder instance
 *
 * @param config - Seeder configuration
 * @param dependencies - Required dependencies
 * @returns A configured Seeder instance
 *
 * @example
 * ```typescript
 * const seeder = createSeeder(
 *   { tenantDiscovery: async () => ['t1', 't2'] },
 *   {
 *     createPool: schemaManager.createPool.bind(schemaManager),
 *     schemaNameTemplate: (id) => `tenant_${id}`,
 *     tenantSchema: schema,
 *   }
 * );
 * ```
 */
export function createSeeder<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  config: SeederConfig,
  dependencies: SeederDependencies<TTenantSchema>
): Seeder<TTenantSchema> {
  return new Seeder(config, dependencies);
}
