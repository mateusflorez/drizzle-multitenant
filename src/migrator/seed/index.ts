/**
 * Tenant Seeding Module
 *
 * Provides tools for seeding tenant databases with initial data
 * in a multi-tenant application.
 *
 * @module seed
 *
 * @example
 * ```typescript
 * import { Seeder, createSeeder } from 'drizzle-multitenant/migrator/seed';
 *
 * const seeder = createSeeder(
 *   { tenantDiscovery: async () => ['tenant-1', 'tenant-2'] },
 *   {
 *     createPool: schemaManager.createPool.bind(schemaManager),
 *     schemaNameTemplate: (id) => `tenant_${id}`,
 *     tenantSchema: schema,
 *   }
 * );
 *
 * // Seed a single tenant
 * await seeder.seedTenant('tenant-1', async (db, tenantId) => {
 *   await db.insert(roles).values([{ name: 'admin' }]);
 * });
 *
 * // Seed all tenants
 * await seeder.seedAll(seedFn, { concurrency: 10 });
 * ```
 */

// Main class and factory
export { Seeder, createSeeder } from './seeder.js';

// Types
export type { SeederConfig, SeederDependencies } from './types.js';

// Re-export public types from main types.ts for convenience
export type {
  SeedFunction,
  SeedOptions,
  TenantSeedResult,
  SeedResults,
} from '../types.js';
