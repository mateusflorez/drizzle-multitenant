import type { Pool, PoolConfig } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Isolation strategy for multi-tenancy
 */
export type IsolationStrategy = 'schema' | 'database' | 'row';

/**
 * Connection configuration
 */
export interface ConnectionConfig {
  /** PostgreSQL connection URL */
  url: string;
  /** Pool configuration options */
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
}

/**
 * Isolation configuration
 */
export interface IsolationConfig {
  /** Isolation strategy (currently only 'schema' is supported) */
  strategy: IsolationStrategy;
  /** Function to generate schema name from tenant ID */
  schemaNameTemplate: (tenantId: string) => string;
  /** Maximum number of simultaneous pools (LRU eviction) */
  maxPools?: number;
  /** TTL in milliseconds before pool cleanup */
  poolTtlMs?: number;
}

/**
 * Schema definitions
 */
export interface SchemasConfig<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Schema applied per tenant */
  tenant: TTenantSchema;
  /** Shared schema (public) */
  shared?: TSharedSchema;
}

/**
 * Lifecycle hooks
 */
export interface Hooks {
  /** Called when a new pool is created */
  onPoolCreated?: (tenantId: string) => void | Promise<void>;
  /** Called when a pool is evicted */
  onPoolEvicted?: (tenantId: string) => void | Promise<void>;
  /** Called on pool error */
  onError?: (tenantId: string, error: Error) => void | Promise<void>;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  /** Enable metrics collection */
  enabled: boolean;
  /** Prefix for metric names */
  prefix?: string;
}

/**
 * Debug configuration for development and troubleshooting
 */
export interface DebugConfig {
  /** Enable debug mode */
  enabled: boolean;
  /** Log SQL queries with tenant context */
  logQueries?: boolean;
  /** Log pool lifecycle events (created, evicted) */
  logPoolEvents?: boolean;
  /** Threshold in ms to log slow queries (default: 1000) */
  slowQueryThreshold?: number;
  /** Custom logger function (default: console.log) */
  logger?: (message: string, context?: DebugContext) => void;
}

/**
 * Context passed to debug logger
 */
export interface DebugContext {
  /** Event type */
  type: 'query' | 'slow_query' | 'pool_created' | 'pool_evicted' | 'pool_error' | 'warmup';
  /** Tenant ID */
  tenantId?: string;
  /** Schema name */
  schemaName?: string;
  /** SQL query (for query events) */
  query?: string;
  /** Query duration in ms */
  durationMs?: number;
  /** Error message */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Main configuration interface
 */
export interface Config<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Database connection settings */
  connection: ConnectionConfig;
  /** Tenant isolation settings */
  isolation: IsolationConfig;
  /** Drizzle schemas */
  schemas: SchemasConfig<TTenantSchema, TSharedSchema>;
  /** Lifecycle hooks */
  hooks?: Hooks;
  /** Metrics configuration */
  metrics?: MetricsConfig;
  /** Debug configuration */
  debug?: DebugConfig;
}

/**
 * Internal pool entry for LRU cache
 */
export interface PoolEntry<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /** Drizzle database instance */
  db: NodePgDatabase<TSchema>;
  /** PostgreSQL pool */
  pool: Pool;
  /** Last access timestamp */
  lastAccess: number;
  /** Schema name */
  schemaName: string;
}

/**
 * Type for tenant database instance
 */
export type TenantDb<TSchema extends Record<string, unknown> = Record<string, unknown>> =
  NodePgDatabase<TSchema>;

/**
 * Type for shared database instance
 */
export type SharedDb<TSchema extends Record<string, unknown> = Record<string, unknown>> =
  NodePgDatabase<TSchema>;

/**
 * Options for pool warmup
 */
export interface WarmupOptions {
  /** Number of concurrent warmup operations */
  concurrency?: number;
  /** Execute a ping query to verify connection */
  ping?: boolean;
  /** Callback for progress updates */
  onProgress?: (tenantId: string, status: 'starting' | 'completed' | 'failed') => void;
}

/**
 * Result for a single tenant warmup
 */
export interface TenantWarmupResult {
  tenantId: string;
  success: boolean;
  /** Whether the pool was already warm */
  alreadyWarm: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Aggregate warmup results
 */
export interface WarmupResult {
  total: number;
  succeeded: number;
  failed: number;
  alreadyWarm: number;
  durationMs: number;
  details: TenantWarmupResult[];
}

/**
 * Tenant manager interface
 */
export interface TenantManager<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Get database instance for a specific tenant */
  getDb(tenantId: string): TenantDb<TTenantSchema>;
  /** Get shared database instance */
  getSharedDb(): SharedDb<TSharedSchema>;
  /** Get the schema name for a tenant */
  getSchemaName(tenantId: string): string;
  /** Check if a tenant pool exists */
  hasPool(tenantId: string): boolean;
  /** Get active pool count */
  getPoolCount(): number;
  /** Get all active tenant IDs */
  getActiveTenantIds(): string[];
  /** Manually evict a tenant pool */
  evictPool(tenantId: string): Promise<void>;
  /** Pre-warm pools for specified tenants to reduce cold start latency */
  warmup(tenantIds: string[], options?: WarmupOptions): Promise<WarmupResult>;
  /** Dispose all pools and cleanup */
  dispose(): Promise<void>;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  maxPools: 50,
  poolTtlMs: 60 * 60 * 1000, // 1 hour
  cleanupIntervalMs: 60_000, // 1 minute
  poolConfig: {
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  },
} as const;
