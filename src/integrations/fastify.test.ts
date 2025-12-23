import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import {
  createFastifyPlugin,
  TenantNotFoundError,
  TenantValidationError,
} from './fastify.js';
import type { TenantManager } from '../types.js';

describe('createFastifyPlugin', () => {
  let mockManager: TenantManager<Record<string, unknown>, Record<string, unknown>>;

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
  });

  describe('plugin registration', () => {
    it('should register plugin successfully', async () => {
      const fastify = Fastify();

      const { plugin } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
      });

      await expect(fastify.register(plugin)).resolves.not.toThrow();
      await fastify.close();
    });

    it('should decorate request with tenantContext', async () => {
      const fastify = Fastify();

      const { plugin } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
      });

      await fastify.register(plugin);

      fastify.get('/test', async (req) => {
        return { hasTenantContext: 'tenantContext' in req };
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-tenant-id': 'test-tenant' },
      });

      expect(response.statusCode).toBe(200);
      await fastify.close();
    });
  });

  describe('extractTenantId', () => {
    it('should extract tenant ID from headers', async () => {
      const fastify = Fastify();

      const { plugin } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
      });

      await fastify.register(plugin);

      fastify.get('/test', async (req) => {
        return { tenantId: req.tenantContext?.tenantId };
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-tenant-id': 'header-tenant' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ tenantId: 'header-tenant' });
      await fastify.close();
    });

    it('should return 400 when tenant ID is missing', async () => {
      const fastify = Fastify();

      const { plugin } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: () => undefined,
      });

      await fastify.register(plugin);

      // Set error handler to prevent Fastify from wrapping the error
      fastify.setErrorHandler((error, _req, reply) => {
        if (error instanceof TenantNotFoundError) {
          reply.status(400).send({ error: 'Tenant ID is required' });
        } else {
          reply.status(500).send({ error: 'Internal error' });
        }
      });

      fastify.get('/test', async () => {
        return { ok: true };
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: 'Tenant ID is required' });
      await fastify.close();
    });
  });

  describe('validateTenant', () => {
    it('should return 403 when validation fails', async () => {
      const fastify = Fastify();

      const { plugin } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
        validateTenant: () => false,
      });

      await fastify.register(plugin);

      fastify.setErrorHandler((error, _req, reply) => {
        if (error instanceof TenantValidationError) {
          reply.status(403).send({ error: 'Invalid tenant' });
        } else if (error instanceof TenantNotFoundError) {
          reply.status(400).send({ error: 'Tenant ID is required' });
        } else {
          reply.status(500).send({ error: 'Internal error' });
        }
      });

      fastify.get('/test', async () => {
        return { ok: true };
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-tenant-id': 'invalid-tenant' },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body)).toEqual({ error: 'Invalid tenant' });
      await fastify.close();
    });

    it('should pass when validation succeeds', async () => {
      const fastify = Fastify();

      const { plugin } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
        validateTenant: () => true,
      });

      await fastify.register(plugin);

      fastify.get('/test', async (req) => {
        return { tenantId: req.tenantContext?.tenantId };
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-tenant-id': 'valid-tenant' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ tenantId: 'valid-tenant' });
      await fastify.close();
    });
  });

  describe('enrichContext', () => {
    it('should add custom context data', async () => {
      const fastify = Fastify();

      const { plugin } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
        enrichContext: () => ({ userId: 'user-123' }),
      });

      await fastify.register(plugin);

      fastify.get('/test', async (req) => {
        return req.tenantContext;
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
        headers: { 'x-tenant-id': 'enriched-tenant' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        tenantId: 'enriched-tenant',
        userId: 'user-123',
      });
      await fastify.close();
    });
  });

  describe('custom error handler', () => {
    it('should use custom error handler', async () => {
      const fastify = Fastify();
      const customHandler = vi.fn(async (_error, _req, reply) => {
        reply.status(418).send({ error: 'Custom error' });
      });

      const { plugin } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: () => undefined,
        onError: customHandler,
      });

      await fastify.register(plugin);

      // Also set error handler to handle the thrown error
      fastify.setErrorHandler((_error, _req, reply) => {
        // Error was already handled by custom handler, just return
        if (reply.sent) return;
        reply.status(418).send({ error: 'Custom error' });
      });

      fastify.get('/test', async () => {
        return { ok: true };
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/test',
      });

      expect(customHandler).toHaveBeenCalled();
      expect(response.statusCode).toBe(418);
      await fastify.close();
    });
  });

  describe('context access', () => {
    it('should expose context utilities', () => {
      const { context } = createFastifyPlugin({
        manager: mockManager,
        extractTenantId: (req) => req.headers['x-tenant-id'] as string,
      });

      expect(context).toBeDefined();
      expect(context.runWithTenant).toBeInstanceOf(Function);
      expect(context.getTenant).toBeInstanceOf(Function);
      expect(context.getTenantDb).toBeInstanceOf(Function);
      expect(context.getSharedDb).toBeInstanceOf(Function);
    });
  });
});

describe('TenantNotFoundError', () => {
  it('should have correct name', () => {
    const error = new TenantNotFoundError();
    expect(error.name).toBe('TenantNotFoundError');
  });
});

describe('TenantValidationError', () => {
  it('should have correct name', () => {
    const error = new TenantValidationError();
    expect(error.name).toBe('TenantValidationError');
  });
});
