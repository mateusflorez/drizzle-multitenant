/**
 * Tenant and Shared Schema Seeding Module
 *
 * Provides tools for seeding tenant and shared databases with initial data
 * in a multi-tenant application.
 *
 * @module seed
 *
 * @example
 * ```typescript
 * import {
 *   Seeder,
 *   createSeeder,
 *   SharedSeeder,
 *   createSharedSeeder,
 * } from 'drizzle-multitenant/migrator/seed';
 *
 * // Tenant seeding
 * const seeder = createSeeder(
 *   { tenantDiscovery: async () => ['tenant-1', 'tenant-2'] },
 *   {
 *     createPool: schemaManager.createPool.bind(schemaManager),
 *     schemaNameTemplate: (id) => `tenant_${id}`,
 *     tenantSchema: schema,
 *   }
 * );
 *
 * await seeder.seedTenant('tenant-1', async (db, tenantId) => {
 *   await db.insert(roles).values([{ name: 'admin' }]);
 * });
 *
 * // Shared schema seeding
 * const sharedSeeder = createSharedSeeder(
 *   { schemaName: 'public' },
 *   {
 *     createPool: () => schemaManager.createPool('public'),
 *     sharedSchema: sharedSchemaDefinition,
 *   }
 * );
 *
 * await sharedSeeder.seed(async (db) => {
 *   await db.insert(plans).values([
 *     { id: 'free', name: 'Free', price: 0 },
 *   ]).onConflictDoNothing();
 * });
 * ```
 */

// Main classes and factories
export { Seeder, createSeeder } from './seeder.js';
export { SharedSeeder, createSharedSeeder } from './shared-seeder.js';

// Types
export type {
  SeederConfig,
  SeederDependencies,
  SharedSeederConfig,
  SharedSeederDependencies,
  SharedSeederHooks,
} from './types.js';

// Re-export public types from main types.ts for convenience
export type {
  SeedFunction,
  SeedOptions,
  TenantSeedResult,
  SeedResults,
  SharedSeedFunction,
  SharedSeedResult,
} from '../types.js';
