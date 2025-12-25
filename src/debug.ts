import type { DebugConfig, DebugContext } from './types.js';

const PREFIX = '[drizzle-multitenant]';
const DEFAULT_SLOW_QUERY_THRESHOLD = 1000;

/**
 * Debug logger for drizzle-multitenant
 * Provides structured logging for queries, pool events, and performance monitoring
 */
export class DebugLogger {
  private readonly enabled: boolean;
  private readonly logQueries: boolean;
  private readonly logPoolEvents: boolean;
  private readonly slowQueryThreshold: number;
  private readonly logger: (message: string, context?: DebugContext) => void;

  constructor(config?: DebugConfig) {
    this.enabled = config?.enabled ?? false;
    this.logQueries = config?.logQueries ?? true;
    this.logPoolEvents = config?.logPoolEvents ?? true;
    this.slowQueryThreshold = config?.slowQueryThreshold ?? DEFAULT_SLOW_QUERY_THRESHOLD;
    this.logger = config?.logger ?? this.defaultLogger;
  }

  /**
   * Check if debug mode is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Log a query execution
   */
  logQuery(tenantId: string, query: string, durationMs: number): void {
    if (!this.enabled || !this.logQueries) return;

    const isSlowQuery = durationMs >= this.slowQueryThreshold;
    const type = isSlowQuery ? 'slow_query' : 'query';

    const context: DebugContext = {
      type,
      tenantId,
      query: this.truncateQuery(query),
      durationMs,
    };

    if (isSlowQuery) {
      this.logger(
        `${PREFIX} tenant=${tenantId} SLOW_QUERY duration=${durationMs}ms query="${this.truncateQuery(query)}"`,
        context
      );
    } else {
      this.logger(
        `${PREFIX} tenant=${tenantId} query="${this.truncateQuery(query)}" duration=${durationMs}ms`,
        context
      );
    }
  }

  /**
   * Log pool creation
   */
  logPoolCreated(tenantId: string, schemaName: string): void {
    if (!this.enabled || !this.logPoolEvents) return;

    const context: DebugContext = {
      type: 'pool_created',
      tenantId,
      schemaName,
    };

    this.logger(
      `${PREFIX} tenant=${tenantId} POOL_CREATED schema=${schemaName}`,
      context
    );
  }

  /**
   * Log pool eviction
   */
  logPoolEvicted(tenantId: string, schemaName: string, reason?: string): void {
    if (!this.enabled || !this.logPoolEvents) return;

    const context: DebugContext = {
      type: 'pool_evicted',
      tenantId,
      schemaName,
      metadata: reason ? { reason } : undefined,
    };

    const reasonStr = reason ? ` reason=${reason}` : '';
    this.logger(
      `${PREFIX} tenant=${tenantId} POOL_EVICTED schema=${schemaName}${reasonStr}`,
      context
    );
  }

  /**
   * Log pool error
   */
  logPoolError(tenantId: string, error: Error): void {
    if (!this.enabled || !this.logPoolEvents) return;

    const context: DebugContext = {
      type: 'pool_error',
      tenantId,
      error: error.message,
    };

    this.logger(
      `${PREFIX} tenant=${tenantId} POOL_ERROR error="${error.message}"`,
      context
    );
  }

  /**
   * Log warmup event
   */
  logWarmup(tenantId: string, success: boolean, durationMs: number, alreadyWarm: boolean): void {
    if (!this.enabled || !this.logPoolEvents) return;

    const context: DebugContext = {
      type: 'warmup',
      tenantId,
      durationMs,
      metadata: { success, alreadyWarm },
    };

    const status = alreadyWarm ? 'already_warm' : (success ? 'success' : 'failed');
    this.logger(
      `${PREFIX} tenant=${tenantId} WARMUP status=${status} duration=${durationMs}ms`,
      context
    );
  }

  /**
   * Log connection retry event
   */
  logConnectionRetry(
    identifier: string,
    attempt: number,
    maxAttempts: number,
    error: Error,
    delayMs: number
  ): void {
    if (!this.enabled || !this.logPoolEvents) return;

    const context: DebugContext = {
      type: 'connection_retry',
      tenantId: identifier,
      error: error.message,
      metadata: { attempt, maxAttempts, delayMs },
    };

    this.logger(
      `${PREFIX} tenant=${identifier} CONNECTION_RETRY attempt=${attempt}/${maxAttempts} delay=${delayMs}ms error="${error.message}"`,
      context
    );
  }

  /**
   * Log connection success after retries
   */
  logConnectionSuccess(identifier: string, attempts: number, totalTimeMs: number): void {
    if (!this.enabled || !this.logPoolEvents) return;

    const context: DebugContext = {
      type: 'pool_created',
      tenantId: identifier,
      durationMs: totalTimeMs,
      metadata: { attempts },
    };

    if (attempts > 1) {
      this.logger(
        `${PREFIX} tenant=${identifier} CONNECTION_SUCCESS attempts=${attempts} totalTime=${totalTimeMs}ms`,
        context
      );
    }
  }

  /**
   * Log a custom debug message
   */
  log(message: string, context?: Partial<DebugContext>): void {
    if (!this.enabled) return;

    this.logger(`${PREFIX} ${message}`, context as DebugContext);
  }

  /**
   * Default logger implementation using console
   */
  private defaultLogger(message: string, _context?: DebugContext): void {
    console.log(message);
  }

  /**
   * Truncate long queries for readability
   */
  private truncateQuery(query: string, maxLength = 100): string {
    const normalized = query.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.substring(0, maxLength - 3) + '...';
  }
}

/**
 * Create a debug logger instance
 */
export function createDebugLogger(config?: DebugConfig): DebugLogger {
  return new DebugLogger(config);
}
