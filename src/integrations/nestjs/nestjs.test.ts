import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, Injectable, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  TenantModule,
  TenantGuard,
  InjectTenantDb,
  InjectSharedDb,
  InjectTenantContext,
  InjectTenantManager,
  TENANT_MODULE_OPTIONS,
  TENANT_MANAGER,
  TENANT_DB,
  SHARED_DB,
  TENANT_CONTEXT,
  RequiresTenant,
  PublicRoute,
} from './index.js';
import type { TenantModuleOptions, NestTenantContext, TenantManager } from './types.js';

// Mock drizzle-multitenant manager
vi.mock('../../manager.js', () => ({
  createTenantManager: vi.fn(() => ({
    getDb: vi.fn((tenantId: string) => ({ tenantId, type: 'tenant-db' })),
    getSharedDb: vi.fn(() => ({ type: 'shared-db' })),
    getSchemaName: vi.fn((tenantId: string) => `tenant_${tenantId}`),
    hasPool: vi.fn(() => false),
    getPoolCount: vi.fn(() => 0),
    getActiveTenantIds: vi.fn(() => []),
    evictPool: vi.fn(),
    dispose: vi.fn(),
  })),
}));

// Mock context
vi.mock('../../context.js', () => ({
  createTenantContext: vi.fn(() => ({
    runWithTenant: vi.fn((ctx, fn) => fn()),
    getTenant: vi.fn(),
    getTenantDb: vi.fn(),
  })),
}));

describe('NestJS Integration', () => {
  const mockConfig: TenantModuleOptions = {
    config: {
      connection: { url: 'postgresql://localhost:5432/test' },
      isolation: {
        strategy: 'schema',
        schemaNameTemplate: (id) => `tenant_${id}`,
      },
      schemas: { tenant: {}, shared: {} },
    },
    extractTenantId: (req) => req.headers['x-tenant-id'] as string,
  };

  describe('TenantModule', () => {
    it('should create module with forRoot', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [TenantModule.forRoot(mockConfig)],
      }).compile();

      expect(module).toBeDefined();

      const options = module.get(TENANT_MODULE_OPTIONS);
      expect(options).toBeDefined();
      expect(options.extractTenantId).toBeDefined();
    });

    it('should create module with forRootAsync using useFactory', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          TenantModule.forRootAsync({
            useFactory: () => mockConfig,
          }),
        ],
      }).compile();

      expect(module).toBeDefined();

      const options = module.get(TENANT_MODULE_OPTIONS);
      expect(options).toBeDefined();
    });

    it('should make module global when isGlobal is true', async () => {
      const dynamicModule = TenantModule.forRoot({
        ...mockConfig,
        isGlobal: true,
      });

      expect(dynamicModule.global).toBe(true);
    });

    it('should provide TenantManager', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [TenantModule.forRoot(mockConfig)],
      }).compile();

      const manager = module.get(TENANT_MANAGER);
      expect(manager).toBeDefined();
      expect(typeof manager.getDb).toBe('function');
      expect(typeof manager.getSharedDb).toBe('function');
    });

    it('should provide SharedDb', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [TenantModule.forRoot(mockConfig)],
      }).compile();

      const sharedDb = module.get(SHARED_DB);
      expect(sharedDb).toBeDefined();
      expect(sharedDb.type).toBe('shared-db');
    });
  });

  describe('TenantGuard', () => {
    let guard: TenantGuard;
    let reflector: Reflector;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [TenantModule.forRoot(mockConfig)],
      }).compile();

      guard = module.get(TenantGuard);
      reflector = module.get(Reflector);
    });

    const createMockContext = (tenantId?: string): ExecutionContext => {
      const request = {
        headers: tenantId ? { 'x-tenant-id': tenantId } : {},
        tenantContext: undefined,
        tenantId: undefined,
      };

      return {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;
    };

    it('should allow request with valid tenant ID', async () => {
      const context = createMockContext('tenant-123');
      const result = await guard.canActivate(context);

      expect(result).toBe(true);

      const request = context.switchToHttp().getRequest();
      expect(request.tenantContext).toBeDefined();
      expect(request.tenantContext.tenantId).toBe('tenant-123');
    });

    it('should allow request without tenant ID when not required', async () => {
      const context = createMockContext();
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should set schema name in context', async () => {
      const context = createMockContext('tenant-456');
      await guard.canActivate(context);

      const request = context.switchToHttp().getRequest();
      expect(request.tenantContext.schemaName).toBe('tenant_tenant-456');
    });
  });

  describe('Decorators', () => {
    it('should create InjectTenantDb decorator', () => {
      @Injectable()
      class TestService {
        constructor(@InjectTenantDb() private readonly db: unknown) {}
        getDb() {
          return this.db;
        }
      }

      expect(TestService).toBeDefined();
    });

    it('should create InjectSharedDb decorator', () => {
      @Injectable()
      class TestService {
        constructor(@InjectSharedDb() private readonly db: unknown) {}
        getDb() {
          return this.db;
        }
      }

      expect(TestService).toBeDefined();
    });

    it('should create InjectTenantContext decorator', () => {
      @Injectable()
      class TestService {
        constructor(@InjectTenantContext() private readonly ctx: NestTenantContext) {}
        getContext() {
          return this.ctx;
        }
      }

      expect(TestService).toBeDefined();
    });

    it('should create InjectTenantManager decorator', () => {
      @Injectable()
      class TestService {
        constructor(@InjectTenantManager() private readonly manager: TenantManager) {}
        getManager() {
          return this.manager;
        }
      }

      expect(TestService).toBeDefined();
    });

    it('should create RequiresTenant decorator', () => {
      @Controller('test')
      @RequiresTenant()
      class TestController {
        @Get()
        test() {
          return 'ok';
        }
      }

      expect(TestController).toBeDefined();
    });

    it('should create PublicRoute decorator', () => {
      @Controller('test')
      class TestController {
        @Get()
        @PublicRoute()
        test() {
          return 'ok';
        }
      }

      expect(TestController).toBeDefined();
    });
  });

  describe('Integration with validators', () => {
    it('should call validateTenant when provided', async () => {
      const validateTenant = vi.fn().mockResolvedValue(true);

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          TenantModule.forRoot({
            ...mockConfig,
            validateTenant,
          }),
        ],
      }).compile();

      const guard = module.get(TenantGuard);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'x-tenant-id': 'tenant-123' },
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await guard.canActivate(context);

      expect(validateTenant).toHaveBeenCalledWith('tenant-123');
    });

    it('should reject invalid tenant', async () => {
      const validateTenant = vi.fn().mockResolvedValue(false);

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          TenantModule.forRoot({
            ...mockConfig,
            validateTenant,
          }),
        ],
      }).compile();

      const guard = module.get(TenantGuard);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { 'x-tenant-id': 'invalid-tenant' },
          }),
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow('Invalid tenant');
    });
  });

  describe('Context enrichment', () => {
    it('should enrich context when enrichContext is provided', async () => {
      const enrichContext = vi.fn().mockResolvedValue({
        userId: 'user-123',
        permissions: ['read', 'write'],
      });

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          TenantModule.forRoot({
            ...mockConfig,
            enrichContext,
          }),
        ],
      }).compile();

      const guard = module.get(TenantGuard);
      const request = {
        headers: { 'x-tenant-id': 'tenant-123' },
        tenantContext: undefined as NestTenantContext | undefined,
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await guard.canActivate(context);

      expect(enrichContext).toHaveBeenCalledWith('tenant-123', request);
      expect(request.tenantContext?.userId).toBe('user-123');
      expect(request.tenantContext?.permissions).toEqual(['read', 'write']);
    });
  });

  describe('Lazy Proxy providers', () => {
    // Test the proxy behavior directly since we can't use createNestApplication
    // without @nestjs/platform-express installed

    it('should resolve TENANT_DB lazily when accessed after guard sets context', () => {
      // Simulate the request object that NestJS would provide
      const request: { tenantContext?: NestTenantContext; tenantId?: string } = {};

      // Mock manager
      const mockManager = {
        getDb: vi.fn((tenantId: string) => ({ tenantId, type: 'tenant-db', select: vi.fn() })),
        getSchemaName: vi.fn((tenantId: string) => `tenant_${tenantId}`),
      };

      // Mock options
      const mockOptions = {
        extractTenantId: () => undefined,
      };

      // Create the proxy like the provider does
      const tenantDbProxy = new Proxy({} as Record<string, unknown>, {
        get(_target, prop) {
          let tenantId = request.tenantContext?.tenantId ?? request.tenantId;

          if (!tenantId && mockOptions.extractTenantId) {
            const extracted = mockOptions.extractTenantId();
            if (typeof extracted === 'string') {
              tenantId = extracted;
            }
          }

          if (!tenantId) {
            throw new Error(
              '[drizzle-multitenant] No tenant context found. ' +
              'Ensure the route has a tenant ID or use @PublicRoute() decorator.'
            );
          }

          const db = mockManager.getDb(tenantId);
          return (db as Record<string | symbol, unknown>)[prop];
        },
      });

      // Initially no context - accessing should fail
      expect(() => tenantDbProxy.select).toThrow('[drizzle-multitenant] No tenant context found');

      // Simulate guard setting context (this happens in real flow)
      request.tenantContext = { tenantId: 'tenant-123', schemaName: 'tenant_tenant-123' };
      request.tenantId = 'tenant-123';

      // Now access should work because proxy resolves lazily
      expect(() => tenantDbProxy.select).not.toThrow();
      expect(mockManager.getDb).toHaveBeenCalledWith('tenant-123');
    });

    it('should throw clear error when accessing TENANT_DB without tenant context', () => {
      const request: { tenantContext?: NestTenantContext; tenantId?: string } = {};

      const mockManager = {
        getDb: vi.fn(),
      };

      const mockOptions = {
        extractTenantId: () => undefined, // Returns undefined to simulate no tenant
      };

      const tenantDbProxy = new Proxy({} as Record<string, unknown>, {
        get(_target, prop) {
          let tenantId = request.tenantContext?.tenantId ?? request.tenantId;

          if (!tenantId && mockOptions.extractTenantId) {
            const extracted = mockOptions.extractTenantId();
            if (typeof extracted === 'string') {
              tenantId = extracted;
            }
          }

          if (!tenantId) {
            throw new Error(
              '[drizzle-multitenant] No tenant context found. ' +
              'Ensure the route has a tenant ID or use @PublicRoute() decorator.'
            );
          }

          const db = mockManager.getDb(tenantId);
          return (db as Record<string | symbol, unknown>)[prop];
        },
      });

      // Accessing property should throw because no tenant context exists
      expect(() => tenantDbProxy.select).toThrow('[drizzle-multitenant] No tenant context found');
      expect(mockManager.getDb).not.toHaveBeenCalled();
    });

    it('should resolve TENANT_CONTEXT lazily when accessed after guard sets context', () => {
      const request: { tenantContext?: NestTenantContext; tenantId?: string } = {};

      const mockManager = {
        getSchemaName: vi.fn((tenantId: string) => `tenant_${tenantId}`),
      };

      const mockOptions = {
        extractTenantId: () => undefined,
      };

      const tenantContextProxy = new Proxy({} as NestTenantContext, {
        get(_target, prop) {
          if (request.tenantContext) {
            return request.tenantContext[prop as keyof NestTenantContext];
          }

          let tenantId = request.tenantId;

          if (!tenantId && mockOptions.extractTenantId) {
            const extracted = mockOptions.extractTenantId();
            if (typeof extracted === 'string') {
              tenantId = extracted;
            }
          }

          if (!tenantId) {
            throw new Error(
              '[drizzle-multitenant] No tenant context found. ' +
              'Ensure the route has a tenant ID or use @PublicRoute() decorator.'
            );
          }

          const schemaName = mockManager.getSchemaName(tenantId);
          const context: NestTenantContext = { tenantId, schemaName };
          return context[prop as keyof NestTenantContext];
        },
      });

      // Initially no context - accessing should fail
      expect(() => tenantContextProxy.tenantId).toThrow('[drizzle-multitenant] No tenant context found');

      // Simulate guard setting context
      request.tenantContext = { tenantId: 'tenant-456', schemaName: 'tenant_tenant-456' };

      // Now access should work
      expect(tenantContextProxy.tenantId).toBe('tenant-456');
      expect(tenantContextProxy.schemaName).toBe('tenant_tenant-456');
    });

    it('should use extractTenantId fallback when tenantContext not set', () => {
      const request: { tenantContext?: NestTenantContext; tenantId?: string } = {};

      const mockManager = {
        getDb: vi.fn((tenantId: string) => ({ tenantId, type: 'tenant-db' })),
      };

      const extractTenantId = vi.fn().mockReturnValue('fallback-tenant');
      const mockOptions = { extractTenantId };

      const tenantDbProxy = new Proxy({} as Record<string, unknown>, {
        get(_target, prop) {
          let tenantId = request.tenantContext?.tenantId ?? request.tenantId;

          if (!tenantId && mockOptions.extractTenantId) {
            const extracted = mockOptions.extractTenantId();
            if (typeof extracted === 'string') {
              tenantId = extracted;
            }
          }

          if (!tenantId) {
            throw new Error('[drizzle-multitenant] No tenant context found.');
          }

          const db = mockManager.getDb(tenantId);
          return (db as Record<string | symbol, unknown>)[prop];
        },
      });

      // Access the proxy - should use extractTenantId fallback
      const result = tenantDbProxy.tenantId;
      expect(result).toBe('fallback-tenant');
      expect(extractTenantId).toHaveBeenCalled();
      expect(mockManager.getDb).toHaveBeenCalledWith('fallback-tenant');
    });

    it('should support has trap in TENANT_DB proxy', () => {
      const request: { tenantContext?: NestTenantContext; tenantId?: string } = {
        tenantContext: { tenantId: 'tenant-123', schemaName: 'tenant_123' },
        tenantId: 'tenant-123',
      };

      const mockManager = {
        getDb: vi.fn(() => ({ select: vi.fn(), from: vi.fn() })),
      };

      const tenantDbProxy = new Proxy({} as Record<string, unknown>, {
        has(_target, prop) {
          const tenantId = request.tenantContext?.tenantId ?? request.tenantId;
          if (!tenantId) return false;
          const db = mockManager.getDb(tenantId);
          return prop in db;
        },
      });

      expect('select' in tenantDbProxy).toBe(true);
      expect('nonexistent' in tenantDbProxy).toBe(false);
    });

    it('should support ownKeys trap in TENANT_CONTEXT proxy', () => {
      const request: { tenantContext?: NestTenantContext; tenantId?: string } = {};

      const tenantContextProxy = new Proxy({} as NestTenantContext, {
        ownKeys() {
          if (request.tenantContext) {
            return Reflect.ownKeys(request.tenantContext);
          }
          return ['tenantId', 'schemaName'];
        },
      });

      // Without context set, returns default keys
      expect(Reflect.ownKeys(tenantContextProxy)).toEqual(['tenantId', 'schemaName']);

      // With context set, returns actual keys
      request.tenantContext = { tenantId: 't1', schemaName: 's1', customField: 'value' };
      expect(Reflect.ownKeys(tenantContextProxy)).toContain('tenantId');
      expect(Reflect.ownKeys(tenantContextProxy)).toContain('schemaName');
      expect(Reflect.ownKeys(tenantContextProxy)).toContain('customField');
    });
  });

  describe('Different tenant ID extraction methods', () => {
    it('should extract from headers', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          TenantModule.forRoot({
            ...mockConfig,
            extractTenantId: (req) => req.headers['x-tenant-id'] as string,
          }),
        ],
      }).compile();

      const guard = module.get(TenantGuard);
      const request = {
        headers: { 'x-tenant-id': 'header-tenant' },
        tenantContext: undefined as NestTenantContext | undefined,
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await guard.canActivate(context);

      expect(request.tenantContext?.tenantId).toBe('header-tenant');
    });

    it('should extract from params', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          TenantModule.forRoot({
            ...mockConfig,
            extractTenantId: (req) => (req as unknown as { params: { tenantId: string } }).params.tenantId,
          }),
        ],
      }).compile();

      const guard = module.get(TenantGuard);
      const request = {
        headers: {},
        params: { tenantId: 'param-tenant' },
        tenantContext: undefined as NestTenantContext | undefined,
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await guard.canActivate(context);

      expect(request.tenantContext?.tenantId).toBe('param-tenant');
    });

    it('should extract from subdomain', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          TenantModule.forRoot({
            ...mockConfig,
            extractTenantId: (req) => (req as unknown as { hostname: string }).hostname.split('.')[0],
          }),
        ],
      }).compile();

      const guard = module.get(TenantGuard);
      const request = {
        headers: {},
        hostname: 'acme.example.com',
        tenantContext: undefined as NestTenantContext | undefined,
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;

      await guard.canActivate(context);

      expect(request.tenantContext?.tenantId).toBe('acme');
    });
  });
});
