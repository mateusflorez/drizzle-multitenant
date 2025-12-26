import type { Config } from '../../types.js';
import type { TenantMigrationStatus, SeedFunction } from '../../migrator/types.js';

/**
 * Source of shared schema configuration
 */
export type SharedConfigSource = 'drizzle.config.ts' | 'tenant.config.ts' | null;

/**
 * Context shared across menu screens
 */
export interface MenuContext {
  config: Config;
  migrationsFolder: string;
  migrationsTable?: string | undefined;
  tenantDiscovery: () => Promise<string[]>;
  /** Path to shared migrations folder (optional) */
  sharedMigrationsFolder?: string | undefined;
  /** Source of shared schema configuration */
  sharedConfigSource?: SharedConfigSource;
  /** Name of the drizzle.config file if detected */
  drizzleKitConfigFile?: string | undefined;
}

/**
 * Status summary for tenants
 */
export interface StatusSummary {
  upToDate: number;
  behind: number;
  error: number;
  totalPending: number;
}

/**
 * Action returned from a screen
 */
export type ScreenAction =
  | { type: 'back' }
  | { type: 'refresh' }
  | { type: 'navigate'; screen: string; params?: Record<string, unknown> }
  | { type: 'exit' };

/**
 * Base interface for all screens
 */
export interface Screen {
  show(): Promise<ScreenAction>;
}

/**
 * Re-export types from migrator
 */
export type { TenantMigrationStatus, SeedFunction };
