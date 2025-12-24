import { DynamicModule, Module, Provider } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { TENANT_MODULE_OPTIONS } from './constants.js';
import { createTenantProviders, createAsyncProviders } from './providers.js';
import { TenantGuard } from './guards.js';
import { TenantContextInterceptor } from './interceptors.js';
import { TenantDbFactory } from './factory.js';
import type { TenantModuleOptions, TenantModuleAsyncOptions } from './types.js';

/**
 * NestJS module for multi-tenant support
 *
 * @example
 * ```typescript
 * // Basic usage
 * @Module({
 *   imports: [
 *     TenantModule.forRoot({
 *       config: tenantConfig,
 *       extractTenantId: (req) => req.headers['x-tenant-id'] as string,
 *       isGlobal: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Async usage with ConfigService
 * @Module({
 *   imports: [
 *     TenantModule.forRootAsync({
 *       imports: [ConfigModule],
 *       useFactory: (configService: ConfigService) => ({
 *         config: defineConfig({
 *           connection: { url: configService.get('DATABASE_URL') },
 *           isolation: {
 *             strategy: 'schema',
 *             schemaNameTemplate: (id) => `tenant_${id}`,
 *           },
 *           schemas: { tenant: tenantSchema },
 *         }),
 *         extractTenantId: (req) => req.params.tenantId,
 *       }),
 *       inject: [ConfigService],
 *       isGlobal: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class TenantModule {
  /**
   * Register the module with static configuration
   */
  static forRoot<
    TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
    TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
  >(options: TenantModuleOptions<TTenantSchema, TSharedSchema>): DynamicModule {
    const providers: Provider[] = [
      {
        provide: TENANT_MODULE_OPTIONS,
        useValue: options,
      },
      ...createTenantProviders<TTenantSchema, TSharedSchema>(),
      Reflector,
      TenantGuard,
      TenantContextInterceptor,
      TenantDbFactory,
    ];

    // Optionally register global guard and interceptor
    if (options.isGlobal) {
      providers.push(
        {
          provide: APP_GUARD,
          useClass: TenantGuard,
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: TenantContextInterceptor,
        }
      );
    }

    const module: DynamicModule = {
      module: TenantModule,
      providers,
      exports: [
        TENANT_MODULE_OPTIONS,
        ...createTenantProviders<TTenantSchema, TSharedSchema>(),
        TenantGuard,
        TenantContextInterceptor,
        TenantDbFactory,
      ],
    };

    if (options.isGlobal) {
      return {
        ...module,
        global: true,
      };
    }

    return module;
  }

  /**
   * Register the module with async configuration
   */
  static forRootAsync<
    TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
    TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
  >(options: TenantModuleAsyncOptions<TTenantSchema, TSharedSchema>): DynamicModule {
    const asyncProviders = createAsyncProviders<TTenantSchema, TSharedSchema>(options);

    const providers: Provider[] = [
      ...asyncProviders,
      ...createTenantProviders<TTenantSchema, TSharedSchema>(),
      Reflector,
      TenantGuard,
      TenantContextInterceptor,
      TenantDbFactory,
    ];

    // Global providers will be added after options are resolved
    // They need access to the options, which are async

    const module: DynamicModule = {
      module: TenantModule,
      imports: options.imports ?? [],
      providers,
      exports: [
        TENANT_MODULE_OPTIONS,
        ...createTenantProviders<TTenantSchema, TSharedSchema>(),
        TenantGuard,
        TenantContextInterceptor,
        TenantDbFactory,
      ],
    };

    if (options.isGlobal) {
      return {
        ...module,
        global: true,
      };
    }

    return module;
  }
}

/**
 * Alias for TenantModule for those who prefer this naming
 */
export const DrizzleMultitenantModule = TenantModule;
