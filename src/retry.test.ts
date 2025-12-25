import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  createRetrier,
  isRetryableError,
  calculateDelay,
} from './retry.js';

describe('isRetryableError', () => {
  it('should return true for connection refused errors', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryableError(new Error('connection refused'))).toBe(true);
  });

  it('should return true for connection reset errors', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableError(new Error('connection reset'))).toBe(true);
  });

  it('should return true for timeout errors', () => {
    expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryableError(new Error('connection timed out'))).toBe(true);
    expect(isRetryableError(new Error('timeout expired'))).toBe(true);
  });

  it('should return true for socket hang up errors', () => {
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
  });

  it('should return true for PostgreSQL transient errors', () => {
    expect(isRetryableError(new Error('too many connections'))).toBe(true);
    expect(isRetryableError(new Error('sorry, too many clients'))).toBe(true);
    expect(isRetryableError(new Error('the database system is starting up'))).toBe(true);
    expect(isRetryableError(new Error('the database system is shutting down'))).toBe(true);
    expect(isRetryableError(new Error('server closed the connection unexpectedly'))).toBe(true);
    expect(isRetryableError(new Error('could not connect to server'))).toBe(true);
  });

  it('should return true for SSL errors', () => {
    expect(isRetryableError(new Error('SSL connection failed'))).toBe(true);
    expect(isRetryableError(new Error('SSL handshake error'))).toBe(true);
  });

  it('should return false for non-retryable errors', () => {
    expect(isRetryableError(new Error('syntax error'))).toBe(false);
    expect(isRetryableError(new Error('authentication failed'))).toBe(false);
    expect(isRetryableError(new Error('permission denied'))).toBe(false);
    expect(isRetryableError(new Error('table does not exist'))).toBe(false);
  });
});

describe('calculateDelay', () => {
  it('should calculate exponential backoff correctly', () => {
    const config = {
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: false,
    };

    expect(calculateDelay(0, config)).toBe(100); // 100 * 2^0 = 100
    expect(calculateDelay(1, config)).toBe(200); // 100 * 2^1 = 200
    expect(calculateDelay(2, config)).toBe(400); // 100 * 2^2 = 400
    expect(calculateDelay(3, config)).toBe(800); // 100 * 2^3 = 800
  });

  it('should cap delay at maxDelayMs', () => {
    const config = {
      initialDelayMs: 100,
      maxDelayMs: 500,
      backoffMultiplier: 2,
      jitter: false,
    };

    expect(calculateDelay(5, config)).toBe(500); // 100 * 2^5 = 3200, capped at 500
    expect(calculateDelay(10, config)).toBe(500); // Still capped
  });

  it('should add jitter when enabled', () => {
    const config = {
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
    };

    // Run multiple times to verify jitter variance
    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) {
      delays.add(calculateDelay(0, config));
    }

    // With jitter, we should get some variance
    // Delay should be between 100 and 125 (100 * 1.25)
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(125);
    }
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should succeed on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const promise = withRetry(operation, { maxAttempts: 3 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.result).toBe('success');
    expect(result.attempts).toBe(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue('success');

    const promise = withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 100,
      jitter: false,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.result).toBe('success');
    expect(result.attempts).toBe(3);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should throw after max attempts', async () => {
    vi.useRealTimers(); // Use real timers for rejection test

    const operation = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        initialDelayMs: 1, // Use minimal delay for speed
        jitter: false,
      })
    ).rejects.toThrow('ECONNREFUSED');

    expect(operation).toHaveBeenCalledTimes(3);

    vi.useFakeTimers(); // Restore fake timers for other tests
  });

  it('should not retry non-retryable errors', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('syntax error'));

    // For non-retryable errors, no timers are needed since it fails immediately
    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        initialDelayMs: 100,
      })
    ).rejects.toThrow('syntax error');

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should call onRetry hook on each retry', async () => {
    const onRetry = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue('success');

    const promise = withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 100,
      jitter: false,
      onRetry,
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 100);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 200);
  });

  it('should use custom isRetryable function', async () => {
    const customIsRetryable = vi.fn().mockReturnValue(true);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('custom error'))
      .mockResolvedValue('success');

    const promise = withRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 100,
      jitter: false,
      isRetryable: customIsRetryable,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.result).toBe('success');
    expect(customIsRetryable).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should calculate total time correctly', async () => {
    vi.useRealTimers(); // Use real timers for this test

    const operation = vi.fn().mockResolvedValue('success');

    const result = await withRetry(operation, { maxAttempts: 1 });

    expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.totalTimeMs).toBeLessThan(100); // Should be very quick
  });

  it('should use default config values', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const promise = withRetry(operation);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.result).toBe('success');
    expect(result.attempts).toBe(1);
  });
});

describe('createRetrier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create a retrier with pre-configured options', async () => {
    const onRetry = vi.fn();
    const retrier = createRetrier({
      maxAttempts: 3,
      initialDelayMs: 50,
      jitter: false,
      onRetry,
    });

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue('success');

    const promise = retrier(operation);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.result).toBe('success');
    expect(result.attempts).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should reuse config across multiple calls', async () => {
    const retrier = createRetrier({
      maxAttempts: 2,
      initialDelayMs: 10,
      jitter: false,
    });

    const op1 = vi.fn().mockResolvedValue('result1');
    const op2 = vi.fn().mockResolvedValue('result2');

    const promise1 = retrier(op1);
    const promise2 = retrier(op2);
    await vi.runAllTimersAsync();

    const result1 = await promise1;
    const result2 = await promise2;

    expect(result1.result).toBe('result1');
    expect(result2.result).toBe('result2');
  });
});
