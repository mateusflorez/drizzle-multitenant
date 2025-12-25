import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetryHandler, createRetryHandler, isRetryableError } from './retry-handler.js';

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

  it('should return true for PostgreSQL transient errors', () => {
    expect(isRetryableError(new Error('too many connections'))).toBe(true);
    expect(isRetryableError(new Error('sorry, too many clients'))).toBe(true);
    expect(isRetryableError(new Error('the database system is starting up'))).toBe(true);
  });

  it('should return false for non-retryable errors', () => {
    expect(isRetryableError(new Error('syntax error'))).toBe(false);
    expect(isRetryableError(new Error('authentication failed'))).toBe(false);
  });
});

describe('RetryHandler', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new RetryHandler({
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
    });
  });

  describe('constructor', () => {
    it('should use default config when not provided', () => {
      const defaultHandler = new RetryHandler();
      const config = defaultHandler.getConfig();

      expect(config.maxAttempts).toBe(3);
      expect(config.initialDelayMs).toBe(100);
      expect(config.maxDelayMs).toBe(5000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.jitter).toBe(true);
    });

    it('should merge provided config with defaults', () => {
      const customHandler = new RetryHandler({ maxAttempts: 5 });
      const config = customHandler.getConfig();

      expect(config.maxAttempts).toBe(5);
      expect(config.initialDelayMs).toBe(100); // default
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await handler.withRetry(operation);

      expect(result.result).toBe('success');
      expect(result.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient errors', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success');

      const result = await handler.withRetry(operation);

      expect(result.result).toBe('success');
      expect(result.attempts).toBe(3);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(handler.withRetry(operation)).rejects.toThrow('ECONNREFUSED');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('syntax error'));

      await expect(handler.withRetry(operation)).rejects.toThrow('syntax error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry hook on each retry', async () => {
      const onRetry = vi.fn();
      const handlerWithHook = new RetryHandler({
        maxAttempts: 3,
        initialDelayMs: 10,
        jitter: false,
        onRetry,
      });

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      await handlerWithHook.withRetry(operation);

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });

    it('should track total time', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      const result = await handler.withRetry(operation);

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should allow overriding config per call', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(handler.withRetry(operation, { maxAttempts: 1 })).rejects.toThrow();
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use custom isRetryable from override config', async () => {
      const customIsRetryable = vi.fn().mockReturnValue(false);
      const operation = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        handler.withRetry(operation, { isRetryable: customIsRetryable })
      ).rejects.toThrow();

      expect(customIsRetryable).toHaveBeenCalled();
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff', () => {
      expect(handler.calculateDelay(0)).toBe(10); // 10 * 2^0
      expect(handler.calculateDelay(1)).toBe(20); // 10 * 2^1
      expect(handler.calculateDelay(2)).toBe(40); // 10 * 2^2
    });

    it('should cap at maxDelayMs', () => {
      expect(handler.calculateDelay(10)).toBe(100); // capped
    });

    it('should allow config override', () => {
      const delay = handler.calculateDelay(0, { initialDelayMs: 50 });
      expect(delay).toBe(50);
    });

    it('should add jitter when enabled', () => {
      const handlerWithJitter = new RetryHandler({
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitter: true,
      });

      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(handlerWithJitter.calculateDelay(0));
      }

      // With jitter, should have some variance
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(100);
        expect(delay).toBeLessThanOrEqual(125);
      }
    });
  });

  describe('isRetryable', () => {
    it('should use configured isRetryable function', () => {
      const customIsRetryable = vi.fn().mockReturnValue(true);
      const customHandler = new RetryHandler({ isRetryable: customIsRetryable });

      customHandler.isRetryable(new Error('any error'));

      expect(customIsRetryable).toHaveBeenCalled();
    });

    it('should use default isRetryable when not configured', () => {
      expect(handler.isRetryable(new Error('ECONNREFUSED'))).toBe(true);
      expect(handler.isRetryable(new Error('syntax error'))).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      const config1 = handler.getConfig();
      const config2 = handler.getConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('getMaxAttempts', () => {
    it('should return max attempts', () => {
      expect(handler.getMaxAttempts()).toBe(3);
    });
  });
});

describe('createRetryHandler', () => {
  it('should create a RetryHandler instance', () => {
    const handler = createRetryHandler({ maxAttempts: 5 });

    expect(handler).toBeInstanceOf(RetryHandler);
    expect(handler.getMaxAttempts()).toBe(5);
  });

  it('should create handler with defaults when no config provided', () => {
    const handler = createRetryHandler();

    expect(handler).toBeInstanceOf(RetryHandler);
    expect(handler.getMaxAttempts()).toBe(3);
  });
});
