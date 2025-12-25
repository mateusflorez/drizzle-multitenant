/**
 * RetryHandler - Retry logic with exponential backoff
 *
 * Extracted from PoolManager as part of the god component refactoring.
 * Provides configurable retry logic for connection operations.
 *
 * @see REFACTOR_PROPOSAL.md
 */

import type { RetryConfig } from '../../types.js';
import { DEFAULT_CONFIG } from '../../types.js';
import type { IRetryHandler, RetryResult } from '../interfaces.js';

/**
 * Default function to determine if an error is retryable
 * Focuses on transient connection errors
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Connection errors
  if (
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('connection refused') ||
    message.includes('connection reset') ||
    message.includes('connection terminated') ||
    message.includes('connection timed out') ||
    message.includes('timeout expired') ||
    message.includes('socket hang up')
  ) {
    return true;
  }

  // PostgreSQL specific transient errors
  if (
    message.includes('too many connections') ||
    message.includes('sorry, too many clients') ||
    message.includes('the database system is starting up') ||
    message.includes('the database system is shutting down') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('could not connect to server')
  ) {
    return true;
  }

  // SSL/TLS errors that might be transient
  if (message.includes('ssl connection') || message.includes('ssl handshake')) {
    return true;
  }

  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry handler with exponential backoff
 *
 * Provides configurable retry logic for operations that may fail
 * with transient errors. Uses exponential backoff with optional jitter
 * to avoid thundering herd problems.
 *
 * @example
 * ```typescript
 * const handler = new RetryHandler({
 *   maxAttempts: 3,
 *   initialDelayMs: 100,
 *   maxDelayMs: 5000,
 *   backoffMultiplier: 2,
 *   jitter: true,
 * });
 *
 * const result = await handler.withRetry(() => connectToDb());
 * console.log(`Succeeded after ${result.attempts} attempts`);
 * ```
 */
export class RetryHandler implements IRetryHandler {
  private readonly config: Required<RetryConfig>;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxAttempts: config?.maxAttempts ?? DEFAULT_CONFIG.retry.maxAttempts,
      initialDelayMs: config?.initialDelayMs ?? DEFAULT_CONFIG.retry.initialDelayMs,
      maxDelayMs: config?.maxDelayMs ?? DEFAULT_CONFIG.retry.maxDelayMs,
      backoffMultiplier: config?.backoffMultiplier ?? DEFAULT_CONFIG.retry.backoffMultiplier,
      jitter: config?.jitter ?? DEFAULT_CONFIG.retry.jitter,
      isRetryable: config?.isRetryable ?? isRetryableError,
      onRetry: config?.onRetry,
    };
  }

  /**
   * Execute an operation with retry logic
   *
   * @param operation - The async operation to execute
   * @param overrideConfig - Optional config to override defaults for this call
   * @returns Result with metadata about attempts and timing
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    overrideConfig?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const config = overrideConfig
      ? { ...this.config, ...overrideConfig }
      : this.config;

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
      try {
        const result = await operation();
        return {
          result,
          attempts: attempt + 1,
          totalTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error as Error;

        // Check if this is the last attempt
        const isLastAttempt = attempt >= config.maxAttempts - 1;

        // Check if error is retryable
        const checkRetryable = config.isRetryable ?? this.isRetryable;
        if (isLastAttempt || !checkRetryable(lastError)) {
          throw lastError;
        }

        // Calculate delay for this attempt
        const delay = this.calculateDelay(attempt, config);

        // Call onRetry hook
        config.onRetry?.(attempt + 1, lastError, delay);

        // Wait before next attempt
        await sleep(delay);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError ?? new Error('Retry failed with no error');
  }

  /**
   * Calculate delay with exponential backoff and optional jitter
   *
   * @param attempt - Current attempt number (0-indexed)
   * @param config - Retry configuration
   * @returns Delay in milliseconds
   */
  calculateDelay(attempt: number, config?: Partial<RetryConfig>): number {
    const cfg = config
      ? { ...this.config, ...config }
      : this.config;

    // Exponential backoff: initialDelay * (multiplier ^ attempt)
    const exponentialDelay = cfg.initialDelayMs * Math.pow(cfg.backoffMultiplier, attempt);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, cfg.maxDelayMs);

    // Add jitter to avoid thundering herd
    if (cfg.jitter) {
      // Random jitter between 0% and 25% of the delay
      const jitterFactor = 1 + Math.random() * 0.25;
      return Math.floor(cappedDelay * jitterFactor);
    }

    return Math.floor(cappedDelay);
  }

  /**
   * Check if an error is retryable
   *
   * Uses the configured isRetryable function or the default implementation.
   */
  isRetryable(error: Error): boolean {
    return (this.config.isRetryable ?? isRetryableError)(error);
  }

  /**
   * Get the current configuration
   */
  getConfig(): Required<RetryConfig> {
    return { ...this.config };
  }

  /**
   * Get the maximum number of attempts
   */
  getMaxAttempts(): number {
    return this.config.maxAttempts;
  }
}

/**
 * Create a retry handler with pre-configured options
 *
 * @example
 * ```typescript
 * const handler = createRetryHandler({
 *   maxAttempts: 5,
 *   initialDelayMs: 200,
 * });
 *
 * const result = await handler.withRetry(() => connectToDb());
 * ```
 */
export function createRetryHandler(config?: Partial<RetryConfig>): RetryHandler {
  return new RetryHandler(config);
}
