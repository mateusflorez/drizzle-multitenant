import { drizzle } from 'drizzle-orm/node-postgres';
import type { SharedSeedFunction, SharedSeedResult } from '../types.js';
import type { ISharedSeeder } from '../interfaces.js';
import type { SharedSeederConfig, SharedSeederDependencies } from './types.js';

const DEFAULT_SHARED_SCHEMA = 'public';

/**
 * Responsible for seeding the shared schema with initial data.
 *
 * Extracted to follow Single Responsibility Principle.
 * Handles seeding the public/shared schema with common data like plans, roles, etc.
 *
 * @example
 * ```typescript
 * const sharedSeeder = new SharedSeeder(config, dependencies);
 *
 * const result = await sharedSeeder.seed(async (db) => {
 *   await db.insert(plans).values([
 *     { id: 'free', name: 'Free', price: 0 },
 *     { id: 'pro', name: 'Pro', price: 29 },
 *   ]).onConflictDoNothing();
 * });
 *
 * if (result.success) {
 *   console.log(`Seeded shared schema in ${result.durationMs}ms`);
 * }
 * ```
 */
export class SharedSeeder<
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> implements ISharedSeeder<TSharedSchema>
{
  private readonly schemaName: string;

  constructor(
    private readonly config: SharedSeederConfig,
    private readonly deps: SharedSeederDependencies<TSharedSchema>
  ) {
    this.schemaName = config.schemaName ?? DEFAULT_SHARED_SCHEMA;
  }

  /**
   * Seed the shared schema with initial data
   *
   * Creates a database connection for the shared schema, executes the seed function,
   * and properly cleans up the connection afterward.
   *
   * @param seedFn - Function that seeds the database
   * @returns Result of the seeding operation
   *
   * @example
   * ```typescript
   * const result = await sharedSeeder.seed(async (db) => {
   *   await db.insert(plans).values([
   *     { id: 'free', name: 'Free Plan', price: 0 },
   *     { id: 'pro', name: 'Pro Plan', price: 29 },
   *     { id: 'enterprise', name: 'Enterprise', price: 99 },
   *   ]).onConflictDoNothing();
   *
   *   await db.insert(roles).values([
   *     { name: 'admin', permissions: ['*'] },
   *     { name: 'user', permissions: ['read'] },
   *   ]).onConflictDoNothing();
   * });
   *
   * if (result.success) {
   *   console.log(`Seeded shared schema in ${result.durationMs}ms`);
   * } else {
   *   console.error(`Failed: ${result.error}`);
   * }
   * ```
   */
  async seed(seedFn: SharedSeedFunction<TSharedSchema>): Promise<SharedSeedResult> {
    const startTime = Date.now();

    const pool = await this.deps.createPool();

    try {
      this.config.hooks?.onStart?.();

      const db = drizzle(pool, {
        schema: this.deps.sharedSchema as TSharedSchema,
      });

      await seedFn(db as any);

      this.config.hooks?.onComplete?.();

      return {
        schemaName: this.schemaName,
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      this.config.hooks?.onError?.(error as Error);

      return {
        schemaName: this.schemaName,
        success: false,
        error: (error as Error).message,
        durationMs: Date.now() - startTime,
      };
    } finally {
      await pool.end();
    }
  }
}

/**
 * Factory function to create a SharedSeeder instance
 *
 * @param config - Shared seeder configuration
 * @param dependencies - Required dependencies
 * @returns A configured SharedSeeder instance
 *
 * @example
 * ```typescript
 * const sharedSeeder = createSharedSeeder(
 *   { schemaName: 'public' },
 *   {
 *     createPool: () => schemaManager.createPool('public'),
 *     sharedSchema: sharedSchemaDefinition,
 *   }
 * );
 *
 * await sharedSeeder.seed(async (db) => {
 *   await db.insert(plans).values([...]);
 * });
 * ```
 */
export function createSharedSeeder<
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  config: SharedSeederConfig,
  dependencies: SharedSeederDependencies<TSharedSchema>
): SharedSeeder<TSharedSchema> {
  return new SharedSeeder(config, dependencies);
}
