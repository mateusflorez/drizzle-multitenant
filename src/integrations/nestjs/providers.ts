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

    // TenantDb - request scoped
    {
      provide: TENANT_DB,
      scope: Scope.REQUEST,
      useFactory: (
        request: TenantRequest,
        manager: TenantManager<TTenantSchema, TSharedSchema>
      ): TenantDb<TTenantSchema> | null => {
        const tenantId = request.tenantContext?.tenantId ?? request.tenantId;

        if (!tenantId) {
          // Return null for routes that don't require tenant
          return null as unknown as TenantDb<TTenantSchema>;
        }

        return manager.getDb(tenantId);
      },
      inject: [REQUEST, TENANT_MANAGER],
    },

    // SharedDb - singleton (doesn't need request scope)
    {
      provide: SHARED_DB,
      useFactory: (manager: TenantManager<TTenantSchema, TSharedSchema>): SharedDb<TSharedSchema> => {
        return manager.getSharedDb();
      },
      inject: [TENANT_MANAGER],
    },

    // TenantContext - request scoped
    {
      provide: TENANT_CONTEXT,
      scope: Scope.REQUEST,
      useFactory: (request: TenantRequest): NestTenantContext | null => {
        return request.tenantContext ?? null;
      },
      inject: [REQUEST],
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
