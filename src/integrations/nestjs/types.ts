import type { ModuleMetadata, Type, InjectionToken } from '@nestjs/common';
import type { Request } from 'express';
import type { Config, TenantManager, TenantDb, SharedDb } from '../../types.js';

/**
 * Function to extract tenant ID from request
 */
export type TenantIdExtractor = (request: Request) => string | undefined | Promise<string | undefined>;

/**
 * Function to validate tenant ID
 */
export type TenantValidator = (tenantId: string) => boolean | Promise<boolean>;

/**
 * Tenant context data available in requests
 */
export interface NestTenantContext {
  /** Current tenant ID */
  tenantId: string;
  /** Schema name for the tenant */
  schemaName: string;
  /** Additional custom data */
  [key: string]: unknown;
}

/**
 * Options for TenantModule.forRoot()
 */
export interface TenantModuleOptions<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Drizzle multitenant configuration */
  config: Config<TTenantSchema, TSharedSchema>;

  /** Function to extract tenant ID from request */
  extractTenantId: TenantIdExtractor;

  /** Optional function to validate tenant ID */
  validateTenant?: TenantValidator;

  /** Whether to make the module global */
  isGlobal?: boolean;

  /** Custom context enrichment */
  enrichContext?: (tenantId: string, request: Request) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * Factory for async options
 */
export interface TenantModuleOptionsFactory<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  createTenantModuleOptions(): Promise<TenantModuleOptions<TTenantSchema, TSharedSchema>> | TenantModuleOptions<TTenantSchema, TSharedSchema>;
}

/**
 * Options for TenantModule.forRootAsync()
 */
export interface TenantModuleAsyncOptions<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> extends Pick<ModuleMetadata, 'imports'> {
  /** Whether to make the module global */
  isGlobal?: boolean;

  /** Use existing provider */
  useExisting?: Type<TenantModuleOptionsFactory<TTenantSchema, TSharedSchema>>;

  /** Use class as factory */
  useClass?: Type<TenantModuleOptionsFactory<TTenantSchema, TSharedSchema>>;

  /** Use factory function */
  useFactory?: (
    ...args: unknown[]
  ) => Promise<TenantModuleOptions<TTenantSchema, TSharedSchema>> | TenantModuleOptions<TTenantSchema, TSharedSchema>;

  /** Dependencies to inject into factory */
  inject?: InjectionToken[];
}

/**
 * Extended request with tenant context
 */
export interface TenantRequest extends Request {
  tenantContext?: NestTenantContext;
  tenantId?: string;
}

/**
 * Debug information available on TenantDb proxy
 */
export interface TenantDbDebugInfo {
  /** Current tenant ID (null if not resolved) */
  tenantId: string | null;
  /** Schema name for the tenant (null if not resolved) */
  schemaName: string | null;
  /** Whether this is a proxy object */
  isProxy: boolean;
  /** Number of active connection pools */
  poolCount: number;
}

/**
 * Extended TenantDb interface with debug utilities
 *
 * Available when using @InjectTenantDb() - provides debugging helpers
 */
export interface TenantDbWithDebug<T extends Record<string, unknown> = Record<string, unknown>> extends TenantDb<T> {
  /** Debug information about the current tenant connection */
  __debug: TenantDbDebugInfo;
  /** Current tenant ID (null if not resolved) */
  __tenantId: string | null;
  /** Whether this is a proxy object */
  __isProxy: true;
}

/**
 * Re-export types for convenience
 */
export type { TenantManager, TenantDb, SharedDb, Config };
