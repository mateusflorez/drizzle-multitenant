/**
 * Retry Handler Module
 *
 * Retry logic with exponential backoff for connection operations.
 *
 * @module pool/retry
 */

export { RetryHandler, createRetryHandler, isRetryableError } from './retry-handler.js';
export type { IRetryHandler, RetryResult } from '../interfaces.js';
