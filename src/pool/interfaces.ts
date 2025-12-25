/**
 * Interfaces for PoolManager module refactoring
 *
 * These interfaces define the contracts for the extracted modules.
 * They should be implemented when refactoring the god component.
 *
 * @see REFACTOR_PROPOSAL.md for full refactoring plan
 */

import type { Pool } from 'pg';
import type {
  PoolEntry,
  TenantDb,
  SharedDb,
  RetryConfig,
  HealthCheckOptions,
  HealthCheckResult,
  PoolHealth,
  MetricsResult,
  TenantPoolMetrics,
  WarmupOptions,
  WarmupResult,
} from '../types.js';

// ============================================================================
// Pool Cache Interfaces
// ============================================================================

/**
 * Cache options for pool storage
 */
export interface PoolCacheOptions {
  /** Maximum number of pools to keep in cache */
  maxPools: number;
  /** Time-to-live for pools in milliseconds */
  poolTtlMs?: number;
  /** Callback when a pool is disposed */
  onDispose?: (schemaName: string, entry: PoolEntry<Record<string, unknown>>) => void | Promise<void>;
}

/**
 * Responsible for LRU caching of database pools
 */
export interface IPoolCache<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Get a pool entry from cache
   */
  get(schemaName: string): PoolEntry<TSchema> | undefined;

  /**
   * Set a pool entry in cache
   */
  set(schemaName: string, entry: PoolEntry<TSchema>): void;

  /**
   * Check if a pool exists in cache
   */
  has(schemaName: string): boolean;

  /**
   * Delete a pool from cache
   */
  delete(schemaName: string): boolean;

  /**
   * Get the number of pools in cache
   */
  size(): number;

  /**
   * Get all schema names in cache
   */
  keys(): string[];

  /**
   * Clear all pools from cache
   */
  clear(): Promise<void>;

  /**
   * Evict the least recently used pool
   */
  evictLRU(): string | undefined;

  /**
   * Evict pools that have exceeded TTL
   */
  evictExpired(): Promise<string[]>;

  /**
   * Update last access time for a pool
   */
  touch(schemaName: string): void;
}

// ============================================================================
// Connection Validator Interfaces
// ============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the connection is valid */
  valid: boolean;
  /** Response time in milliseconds */
  responseTimeMs?: number;
  /** Error if validation failed */
  error?: Error;
}

/**
 * Responsible for validating database connections
 */
export interface IConnectionValidator {
  /**
   * Validate a connection by executing a ping query
   */
  validate(pool: Pool): Promise<ValidationResult>;

  /**
   * Validate a connection with retry logic
   */
  validateWithRetry(pool: Pool, config: RetryConfig): Promise<ValidationResult>;

  /**
   * Check if a pool is still responsive
   */
  ping(pool: Pool, timeoutMs?: number): Promise<boolean>;
}

// ============================================================================
// Retry Handler Interfaces
// ============================================================================

/**
 * Retry execution result
 */
export interface RetryResult<T> {
  /** The result of the operation */
  result: T;
  /** Number of attempts made */
  attempts: number;
  /** Total time spent in milliseconds */
  totalTimeMs: number;
}

/**
 * Responsible for retry logic with exponential backoff
 */
export interface IRetryHandler {
  /**
   * Execute an operation with retry logic
   */
  withRetry<T>(
    operation: () => Promise<T>,
    config?: Partial<RetryConfig>
  ): Promise<RetryResult<T>>;

  /**
   * Calculate delay for a given attempt
   */
  calculateDelay(attempt: number, config: RetryConfig): number;

  /**
   * Check if an error is retryable
   */
  isRetryable(error: Error): boolean;
}

// ============================================================================
// Health Checker Interfaces
// ============================================================================

/**
 * Pool health status
 */
export interface PoolHealthInfo {
  tenantId: string;
  schemaName: string;
  status: 'ok' | 'degraded' | 'unhealthy';
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
  responseTimeMs?: number;
  error?: string;
}

/**
 * Responsible for checking health of database pools
 */
export interface IHealthChecker<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Check health of all pools
   */
  checkHealth(options?: HealthCheckOptions): Promise<HealthCheckResult>;

  /**
   * Check health of a specific pool
   */
  checkPool(
    tenantId: string,
    schemaName: string,
    entry: PoolEntry<TSchema>,
    options?: { ping?: boolean }
  ): Promise<PoolHealthInfo>;

  /**
   * Check health of shared database
   */
  checkSharedDb(pool: Pool, options?: { ping?: boolean }): Promise<{
    status: 'ok' | 'degraded' | 'unhealthy';
    responseTimeMs?: number;
    error?: string;
  }>;

  /**
   * Determine overall health status
   */
  determineOverallHealth(pools: PoolHealthInfo[]): boolean;
}

// ============================================================================
// Metrics Collector Interfaces
// ============================================================================

/**
 * Connection metrics for a pool
 */
export interface ConnectionMetrics {
  total: number;
  idle: number;
  waiting: number;
}

/**
 * Responsible for collecting pool metrics
 */
export interface IMetricsCollector<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Get metrics for all pools
   */
  getMetrics(): MetricsResult;

  /**
   * Get metrics for a specific pool
   */
  getPoolMetrics(entry: PoolEntry<TSchema>): ConnectionMetrics;

  /**
   * Get tenant-specific metrics
   */
  getTenantMetrics(
    tenantId: string,
    schemaName: string,
    entry: PoolEntry<TSchema>
  ): TenantPoolMetrics;
}

// ============================================================================
// Pool Factory Interfaces
// ============================================================================

/**
 * Options for creating a pool
 */
export interface CreatePoolOptions {
  /** Tenant ID */
  tenantId: string;
  /** Schema name */
  schemaName: string;
  /** Validate connection after creation */
  validate?: boolean;
}

/**
 * Responsible for creating database pools
 */
export interface IPoolFactory<TSchema extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Create a new pool for a tenant
   */
  createPool(options: CreatePoolOptions): PoolEntry<TSchema>;

  /**
   * Create a shared database pool
   */
  createSharedPool(): Pool;

  /**
   * Create a Drizzle database instance from a pool
   */
  createDb(pool: Pool, schema: TSchema): TenantDb<TSchema>;
}

// ============================================================================
// Lifecycle Hooks Interfaces
// ============================================================================

/**
 * Pool lifecycle hooks
 */
export interface PoolHooks {
  onPoolCreated?: (tenantId: string) => void | Promise<void>;
  onPoolEvicted?: (tenantId: string) => void | Promise<void>;
  onError?: (tenantId: string, error: Error) => void | Promise<void>;
}

/**
 * Responsible for managing lifecycle hooks
 */
export interface ILifecycleHooks {
  /**
   * Register hooks
   */
  setHooks(hooks: PoolHooks): void;

  /**
   * Emit pool created event
   */
  emitPoolCreated(tenantId: string): Promise<void>;

  /**
   * Emit pool evicted event
   */
  emitPoolEvicted(tenantId: string): Promise<void>;

  /**
   * Emit error event
   */
  emitError(tenantId: string, error: Error): Promise<void>;
}

// ============================================================================
// Pool Manager Facade Interface
// ============================================================================

/**
 * Main PoolManager interface (facade pattern)
 *
 * Delegates to internal modules while preserving the current public API.
 */
export interface IPoolManager<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  // Pool access
  getDb(tenantId: string): TenantDb<TTenantSchema>;
  getDbAsync(tenantId: string): Promise<TenantDb<TTenantSchema>>;
  getSharedDb(): SharedDb<TSharedSchema>;
  getSharedDbAsync(): Promise<SharedDb<TSharedSchema>>;

  // Pool information
  getSchemaName(tenantId: string): string;
  hasPool(tenantId: string): boolean;
  getPoolCount(): number;
  getActiveTenantIds(): string[];

  // Pool management
  evictPool(tenantId: string): Promise<void>;
  warmup(tenantIds: string[], options?: WarmupOptions): Promise<WarmupResult>;
  dispose(): Promise<void>;

  // Cleanup
  startCleanup(): void;
  stopCleanup(): void;

  // Health & Metrics
  healthCheck(options?: HealthCheckOptions): Promise<HealthCheckResult>;
  getMetrics(): MetricsResult;
}

// ============================================================================
// TTL Manager Interfaces
// ============================================================================

/**
 * Responsible for TTL-based pool cleanup
 */
export interface ITTLManager {
  /**
   * Start the cleanup interval
   */
  start(intervalMs?: number): void;

  /**
   * Stop the cleanup interval
   */
  stop(): void;

  /**
   * Check if a pool entry has expired
   */
  isExpired(entry: PoolEntry<Record<string, unknown>>, ttlMs: number): boolean;

  /**
   * Run a single cleanup cycle
   */
  cleanup(): Promise<void>;
}
