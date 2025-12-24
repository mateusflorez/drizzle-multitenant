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
        // Helper to resolve tenantId
        const resolveTenantId = (): string | undefined => {
          let tenantId = request.tenantContext?.tenantId ?? request.tenantId;

          if (!tenantId && options.extractTenantId) {
            const extracted = options.extractTenantId(request);
            if (typeof extracted === 'string') {
              tenantId = extracted;
            }
          }

          return tenantId;
        };

        // Symbol for Node.js util.inspect custom formatting
        const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');

        // Debug properties that are always available
        const debugProps = ['__debug', '__tenantId', '__isProxy'] as const;

        // Return a proxy that resolves the db only when accessed
        return new Proxy({} as TenantDb<TTenantSchema>, {
          get(_target, prop) {
            // Debug utilities - accessible even without tenant context
            if (prop === Symbol.toStringTag) return 'TenantDb';

            // Get resolved tenant ID for debug info
            const resolvedTenantId = resolveTenantId();

            // Custom inspect for console.log / util.inspect
            if (prop === inspectSymbol || prop === 'toString') {
              return () => {
                if (resolvedTenantId) {
                  return `[TenantDb] tenant=${resolvedTenantId} schema=${manager.getSchemaName(resolvedTenantId)}`;
                }
                return '[TenantDb] (no tenant context)';
              };
            }

            if (prop === '__debug') {
              return {
                tenantId: resolvedTenantId ?? null,
                schemaName: resolvedTenantId ? manager.getSchemaName(resolvedTenantId) : null,
                isProxy: true,
                poolCount: manager.getPoolCount(),
              };
            }

            if (prop === '__tenantId') {
              return resolvedTenantId ?? null;
            }

            if (prop === '__isProxy') {
              return true;
            }

            // For actual db operations, require tenant context
            if (!resolvedTenantId) {
              throw new Error(
                '[drizzle-multitenant] No tenant context found. ' +
                'Ensure the route has a tenant ID or use @PublicRoute() decorator.'
              );
            }

            const db = manager.getDb(resolvedTenantId);
            return (db as unknown as Record<string | symbol, unknown>)[prop];
          },
          has(_target, prop) {
            // Debug props are always available
            if (debugProps.includes(prop as typeof debugProps[number])) return true;

            const tenantId = request.tenantContext?.tenantId ?? request.tenantId;
            if (!tenantId) return false;
            const db = manager.getDb(tenantId);
            return prop in db;
          },
          ownKeys() {
            const tenantId = request.tenantContext?.tenantId ?? request.tenantId;
            if (!tenantId) {
              // Return debug props when no tenant context
              return [...debugProps];
            }
            const db = manager.getDb(tenantId);
            return [...new Set([...debugProps, ...Reflect.ownKeys(db as object)])];
          },
          getOwnPropertyDescriptor(_target, prop) {
            // Debug props are always available
            if (debugProps.includes(prop as typeof debugProps[number])) {
              return { configurable: true, enumerable: true, writable: false };
            }

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
        // Symbol for Node.js util.inspect custom formatting
        const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');

        // Helper to resolve tenant context
        const resolveContext = (): { tenantId: string; schemaName: string } | null => {
          if (request.tenantContext) {
            return {
              tenantId: request.tenantContext.tenantId,
              schemaName: request.tenantContext.schemaName,
            };
          }

          let tenantId = request.tenantId;
          if (!tenantId && options.extractTenantId) {
            const extracted = options.extractTenantId(request);
            if (typeof extracted === 'string') {
              tenantId = extracted;
            }
          }

          if (!tenantId) return null;

          return {
            tenantId,
            schemaName: manager.getSchemaName(tenantId),
          };
        };

        // Return a proxy that resolves the context only when accessed
        return new Proxy({} as NestTenantContext, {
          get(_target, prop) {
            // Debug utilities
            if (prop === Symbol.toStringTag) return 'TenantContext';

            const ctx = resolveContext();

            // Custom inspect for console.log / util.inspect
            if (prop === inspectSymbol || prop === 'toString') {
              return () => {
                if (ctx) {
                  return `[TenantContext] tenant=${ctx.tenantId} schema=${ctx.schemaName}`;
                }
                return '[TenantContext] (no tenant context)';
              };
            }

            if (prop === '__debug') {
              return {
                tenantId: ctx?.tenantId ?? null,
                schemaName: ctx?.schemaName ?? null,
                isProxy: true,
                hasContext: !!request.tenantContext,
              };
            }

            if (prop === '__isProxy') {
              return true;
            }

            // For actual context access, require tenant
            if (!ctx) {
              throw new Error(
                '[drizzle-multitenant] No tenant context found. ' +
                'Ensure the route has a tenant ID or use @PublicRoute() decorator.'
              );
            }

            if (prop === 'tenantId') return ctx.tenantId;
            if (prop === 'schemaName') return ctx.schemaName;

            // For custom properties, check the original context
            if (request.tenantContext) {
              return request.tenantContext[prop as keyof NestTenantContext];
            }

            return undefined;
          },
          has(_target, prop) {
            if (prop === '__debug' || prop === '__isProxy') return true;
            if (request.tenantContext) {
              return prop in request.tenantContext;
            }
            return prop === 'tenantId' || prop === 'schemaName';
          },
          ownKeys() {
            const baseKeys = ['tenantId', 'schemaName', '__debug', '__isProxy'];
            if (request.tenantContext) {
              return [...new Set([...baseKeys, ...Reflect.ownKeys(request.tenantContext)])];
            }
            return baseKeys;
          },
          getOwnPropertyDescriptor(_target, prop) {
            if (prop === '__debug' || prop === '__isProxy') {
              return { configurable: true, enumerable: true, writable: false };
            }
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
