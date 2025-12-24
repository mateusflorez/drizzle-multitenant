/**
 * Injection tokens for NestJS
 */

/** Token for injecting the TenantManager */
export const TENANT_MANAGER = Symbol('TENANT_MANAGER');

/** Token for injecting the tenant database */
export const TENANT_DB = Symbol('TENANT_DB');

/** Token for injecting the shared database */
export const SHARED_DB = Symbol('SHARED_DB');

/** Token for injecting the tenant context */
export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

/** Token for the module configuration */
export const TENANT_MODULE_OPTIONS = Symbol('TENANT_MODULE_OPTIONS');

/** Token for the tenant ID extractor function */
export const TENANT_ID_EXTRACTOR = Symbol('TENANT_ID_EXTRACTOR');

/** Metadata key for tenant requirement */
export const REQUIRES_TENANT_KEY = 'requires_tenant';

/** Metadata key for public routes (no tenant required) */
export const IS_PUBLIC_KEY = 'is_public_tenant';

/** Token for injecting the TenantDbFactory */
export const TENANT_DB_FACTORY = Symbol('TENANT_DB_FACTORY');
