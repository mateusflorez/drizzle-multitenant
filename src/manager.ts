import { PoolManager } from './pool.js';
import type {
  Config,
  TenantManager,
  TenantDb,
  SharedDb,
  WarmupOptions,
  WarmupResult,
  RetryConfig,
  HealthCheckOptions,
  HealthCheckResult,
} from './types.js';

/**
 * Create a tenant manager instance
 *
 * @example
 * ```typescript
 * import { createTenantManager, defineConfig } from 'drizzle-multitenant';
 *
 * const config = defineConfig({
 *   connection: { url: process.env.DATABASE_URL! },
 *   isolation: {
 *     strategy: 'schema',
 *     schemaNameTemplate: (id) => `tenant_${id}`,
 *   },
 *   schemas: { tenant: tenantSchema },
 * });
 *
 * const tenants = createTenantManager(config);
 *
 * // Get database for a specific tenant
 * const db = tenants.getDb('tenant-uuid');
 * const users = await db.select().from(schema.users);
 *
 * // Get shared database
 * const sharedDb = tenants.getSharedDb();
 * const plans = await sharedDb.select().from(sharedSchema.plans);
 * ```
 */
export function createTenantManager<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(config: Config<TTenantSchema, TSharedSchema>): TenantManager<TTenantSchema, TSharedSchema> {
  const poolManager = new PoolManager(config);

  // Start automatic cleanup
  poolManager.startCleanup();

  return {
    getDb(tenantId: string): TenantDb<TTenantSchema> {
      return poolManager.getDb(tenantId);
    },

    async getDbAsync(tenantId: string): Promise<TenantDb<TTenantSchema>> {
      return poolManager.getDbAsync(tenantId);
    },

    getSharedDb(): SharedDb<TSharedSchema> {
      return poolManager.getSharedDb();
    },

    async getSharedDbAsync(): Promise<SharedDb<TSharedSchema>> {
      return poolManager.getSharedDbAsync();
    },

    getSchemaName(tenantId: string): string {
      return poolManager.getSchemaName(tenantId);
    },

    hasPool(tenantId: string): boolean {
      return poolManager.hasPool(tenantId);
    },

    getPoolCount(): number {
      return poolManager.getPoolCount();
    },

    getActiveTenantIds(): string[] {
      return poolManager.getActiveTenantIds();
    },

    getRetryConfig(): Required<RetryConfig> {
      return poolManager.getRetryConfig();
    },

    async evictPool(tenantId: string): Promise<void> {
      await poolManager.evictPool(tenantId);
    },

    async warmup(tenantIds: string[], options?: WarmupOptions): Promise<WarmupResult> {
      return poolManager.warmup(tenantIds, options);
    },

    async healthCheck(options?: HealthCheckOptions): Promise<HealthCheckResult> {
      return poolManager.healthCheck(options);
    },

    async dispose(): Promise<void> {
      await poolManager.dispose();
    },
  };
}
