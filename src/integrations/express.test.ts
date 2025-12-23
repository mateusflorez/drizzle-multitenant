import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  createExpressMiddleware,
  TenantNotFoundError,
  TenantValidationError,
} from './express.js';
import type { TenantManager } from '../types.js';

describe('createExpressMiddleware', () => {
  let mockManager: TenantManager<Record<string, unknown>, Record<string, unknown>>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockManager = {
      getDb: vi.fn().mockReturnValue({ tenant: true }),
      getSharedDb: vi.fn().mockReturnValue({ shared: true }),
      getSchemaName: vi.fn((id) => `tenant_${id}`),
      hasPool: vi.fn().mockReturnValue(false),
      getPoolCount: vi.fn().mockReturnValue(0),
      getActiveTenantIds: vi.fn().mockReturnValue([]),
      evictPool: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    mockReq = {
      headers: {},
      params: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      on: vi.fn((event, callback) => {
        if (event === 'finish') {
          // Simulate response finish
          setTimeout(callback, 0);
        }
        return mockRes as Response;
      }),
    };

    mockNext = vi.fn();
  });

  describe('extractTenantId', () => {
    it('should extract tenant ID from headers', async () => {
      mockReq.headers = { 'x-tenant-id': 'header-tenant' };

      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should extract tenant ID from params', async () => {
      mockReq.params = { tenantId: 'param-tenant' };

      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: (req) => req.params.tenantId,
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should support async extractTenantId', async () => {
      mockReq.headers = { 'x-tenant-id': 'async-tenant' };

      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: async (req) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return req.headers['x-tenant-id'] as string;
        },
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return 400 when tenant ID is missing', async () => {
      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: () => undefined,
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Tenant ID is required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 when validation fails', async () => {
      mockReq.headers = { 'x-tenant-id': 'invalid-tenant' };

      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
        validateTenant: () => false,
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid tenant' });
    });

    it('should use custom error handler', async () => {
      const customHandler = vi.fn();

      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: () => undefined,
        onError: customHandler,
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(customHandler).toHaveBeenCalled();
      expect(customHandler.mock.calls[0]?.[0]).toBeInstanceOf(TenantNotFoundError);
    });
  });

  describe('validateTenant', () => {
    it('should call validateTenant with tenantId and request', async () => {
      mockReq.headers = { 'x-tenant-id': 'validated-tenant' };
      const validateTenant = vi.fn().mockResolvedValue(true);

      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
        validateTenant,
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(validateTenant).toHaveBeenCalledWith('validated-tenant', mockReq);
    });

    it('should support async validation', async () => {
      mockReq.headers = { 'x-tenant-id': 'async-validated' };

      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
        validateTenant: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return true;
        },
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('enrichContext', () => {
    it('should add custom context data', async () => {
      mockReq.headers = { 'x-tenant-id': 'enriched-tenant' };

      interface CustomContext {
        userId: string;
      }

      const middleware = createExpressMiddleware<
        Record<string, unknown>,
        Record<string, unknown>,
        CustomContext
      >({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
        enrichContext: () => ({ userId: 'user-123' }),
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as any).tenantContext).toEqual({
        tenantId: 'enriched-tenant',
        userId: 'user-123',
      });
    });

    it('should support async enrichContext', async () => {
      mockReq.headers = { 'x-tenant-id': 'async-enriched' };

      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
        enrichContext: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { extra: 'data' };
        },
      });

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect((mockReq as any).tenantContext).toEqual({
        tenantId: 'async-enriched',
        extra: 'data',
      });
    });
  });

  describe('context access', () => {
    it('should expose context utilities', () => {
      const middleware = createExpressMiddleware({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
      });

      expect(middleware.context).toBeDefined();
      expect(middleware.context.runWithTenant).toBeInstanceOf(Function);
      expect(middleware.context.getTenant).toBeInstanceOf(Function);
      expect(middleware.context.getTenantDb).toBeInstanceOf(Function);
      expect(middleware.context.getSharedDb).toBeInstanceOf(Function);
    });
  });
});

describe('TenantNotFoundError', () => {
  it('should have correct name', () => {
    const error = new TenantNotFoundError();
    expect(error.name).toBe('TenantNotFoundError');
  });

  it('should accept custom message', () => {
    const error = new TenantNotFoundError('Custom message');
    expect(error.message).toBe('Custom message');
  });
});

describe('TenantValidationError', () => {
  it('should have correct name', () => {
    const error = new TenantValidationError();
    expect(error.name).toBe('TenantValidationError');
  });

  it('should accept custom message', () => {
    const error = new TenantValidationError('Custom message');
    expect(error.message).toBe('Custom message');
  });
});
