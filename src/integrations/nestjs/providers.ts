import { Provider, Scope, InjectionToken } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { createTenantManager } from '../../manager.js';
import type { TenantManager, TenantDb, SharedDb } from '../../types.js';
import {
  TENANT_MANAGER,
  TENANT_DB,
  SHARED_DB,
  TENANT_CONTEXT,
  TENANT_MODULE_OPTIONS,
} from './constants.js';
import type { TenantModuleOptions, TenantRequest, NestTenantContext } from './types.js';

/**
 * Create providers for the tenant module
 */
export function createTenantProviders<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
>(): Provider[] {
  return [
    // TenantManager - singleton
    {
      provide: TENANT_MANAGER,
      useFactory: (options: TenantModuleOptions<TTenantSchema, TSharedSchema>): TenantManager<TTenantSchema, TSharedSchema> => {
        return createTenantManager(options.config);
      },
      inject: [TENANT_MODULE_OPTIONS],
    },

    // TenantDb - request scoped with lazy resolution via Proxy
    // This fixes the timing issue where TENANT_DB is resolved before TenantGuard executes
    {
      provide: TENANT_DB,
      scope: Scope.REQUEST,
      useFactory: (
        request: TenantRequest,
        manager: TenantManager<TTenantSchema, TSharedSchema>,
        options: TenantModuleOptions<TTenantSchema, TSharedSchema>
      ): TenantDb<TTenantSchema> => {
        // Return a proxy that resolves the db only when accessed
        return new Proxy({} as TenantDb<TTenantSchema>, {
          get(_target, prop) {
            // Resolve tenantId at access time (after guard has executed)
            let tenantId = request.tenantContext?.tenantId ?? request.tenantId;

            // Fallback: extract from request if not set yet
            if (!tenantId && options.extractTenantId) {
              const extracted = options.extractTenantId(request);
              // Handle sync extraction only (async would require different approach)
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

            const db = manager.getDb(tenantId);
            return (db as unknown as Record<string | symbol, unknown>)[prop];
          },
          has(_target, prop) {
            const tenantId = request.tenantContext?.tenantId ?? request.tenantId;
            if (!tenantId) return false;
            const db = manager.getDb(tenantId);
            return prop in db;
          },
          ownKeys() {
            const tenantId = request.tenantContext?.tenantId ?? request.tenantId;
            if (!tenantId) return [];
            const db = manager.getDb(tenantId);
            return Reflect.ownKeys(db as object);
          },
          getOwnPropertyDescriptor(_target, prop) {
            const tenantId = request.tenantContext?.tenantId ?? request.tenantId;
            if (!tenantId) return undefined;
            const db = manager.getDb(tenantId);
            return Object.getOwnPropertyDescriptor(db, prop);
          },
        });
      },
      inject: [REQUEST, TENANT_MANAGER, TENANT_MODULE_OPTIONS],
    },

    // SharedDb - singleton (doesn't need request scope)
    {
      provide: SHARED_DB,
      useFactory: (manager: TenantManager<TTenantSchema, TSharedSchema>): SharedDb<TSharedSchema> => {
        return manager.getSharedDb();
      },
      inject: [TENANT_MANAGER],
    },

    // TenantContext - request scoped with lazy resolution via Proxy
    // This fixes the timing issue where TENANT_CONTEXT is resolved before TenantGuard executes
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      useFactory: (
        request: TenantRequest,
        manager: TenantManager<TTenantSchema, TSharedSchema>,
        options: TenantModuleOptions<TTenantSchema, TSharedSchema>
      ): NestTenantContext => {
        // Return a proxy that resolves the context only when accessed
        return new Proxy({} as NestTenantContext, {
          get(_target, prop) {
            // First check if context was already set by guard
            if (request.tenantContext) {
              return request.tenantContext[prop as keyof NestTenantContext];
            }

            // Fallback: try to build context from tenantId
            let tenantId = request.tenantId;

            if (!tenantId && options.extractTenantId) {
              const extracted = options.extractTenantId(request);
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

            // Build context lazily
            const schemaName = manager.getSchemaName(tenantId);
            const context: NestTenantContext = { tenantId, schemaName };
            return context[prop as keyof NestTenantContext];
          },
          has(_target, prop) {
            if (request.tenantContext) {
              return prop in request.tenantContext;
            }
            return prop === 'tenantId' || prop === 'schemaName';
          },
          ownKeys() {
            if (request.tenantContext) {
              return Reflect.ownKeys(request.tenantContext);
            }
            return ['tenantId', 'schemaName'];
          },
          getOwnPropertyDescriptor(_target, prop) {
            if (request.tenantContext) {
              return Object.getOwnPropertyDescriptor(request.tenantContext, prop);
            }
            if (prop === 'tenantId' || prop === 'schemaName') {
              return { configurable: true, enumerable: true, writable: true };
            }
            return undefined;
          },
        });
      },
      inject: [REQUEST, TENANT_MANAGER, TENANT_MODULE_OPTIONS],
    },
  ];
}

/**
 * Create async providers for dynamic module configuration
 */
export function createAsyncProviders<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
>(
  options: {
    useFactory?: (...args: unknown[]) => Promise<TenantModuleOptions<TTenantSchema, TSharedSchema>> | TenantModuleOptions<TTenantSchema, TSharedSchema>;
    inject?: InjectionToken[];
    useClass?: new (...args: unknown[]) => { createTenantModuleOptions(): Promise<TenantModuleOptions<TTenantSchema, TSharedSchema>> | TenantModuleOptions<TTenantSchema, TSharedSchema> };
    useExisting?: new (...args: unknown[]) => { createTenantModuleOptions(): Promise<TenantModuleOptions<TTenantSchema, TSharedSchema>> | TenantModuleOptions<TTenantSchema, TSharedSchema> };
  }
): Provider[] {
  const providers: Provider[] = [];

  if (options.useFactory) {
    providers.push({
      provide: TENANT_MODULE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    });
  } else if (options.useClass) {
    providers.push({
      provide: TENANT_MODULE_OPTIONS,
      useFactory: async (factory: { createTenantModuleOptions(): Promise<TenantModuleOptions<TTenantSchema, TSharedSchema>> | TenantModuleOptions<TTenantSchema, TSharedSchema> }) => {
        return factory.createTenantModuleOptions();
      },
      inject: [options.useClass],
    });
    providers.push({
      provide: options.useClass,
      useClass: options.useClass,
    });
  } else if (options.useExisting) {
    providers.push({
      provide: TENANT_MODULE_OPTIONS,
      useFactory: async (factory: { createTenantModuleOptions(): Promise<TenantModuleOptions<TTenantSchema, TSharedSchema>> | TenantModuleOptions<TTenantSchema, TSharedSchema> }) => {
        return factory.createTenantModuleOptions();
      },
      inject: [options.useExisting],
    });
  }

  return providers;
}
