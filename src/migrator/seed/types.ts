/**
 * Internal types for the Seeder module
 *
 * Public types are re-exported from the main types.ts file
 * @module seed/types
 */

import type { SeedOptions as PublicSeedOptions } from '../types.js';

/**
 * Extended seed options with internal properties
 */
export interface InternalSeedOptions extends PublicSeedOptions {
  /** Whether to skip non-existent schemas (default: true) */
  skipMissing?: boolean;
}

/**
 * Configuration for the Seeder
 */
export interface SeederConfig {
  /** Function to discover tenant IDs */
  tenantDiscovery: () => Promise<string[]>;
}

/**
 * Seeder dependencies
 */
export interface SeederDependencies<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Pool creation for specific schemas */
  createPool: (schemaName: string) => Promise<import('pg').Pool>;
  /** Schema name template function */
  schemaNameTemplate: (tenantId: string) => string;
  /** Tenant schema definition */
  tenantSchema: TTenantSchema;
}
