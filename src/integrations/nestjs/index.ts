// Module
export { TenantModule, DrizzleMultitenantModule } from './tenant.module.js';

// Decorators
export {
  InjectTenantDb,
  InjectSharedDb,
  InjectTenantContext,
  InjectTenantManager,
  TenantCtx,
  TenantId,
  RequiresTenant,
  PublicRoute,
} from './decorators.js';

// Guards
export { TenantGuard, RequireTenantGuard } from './guards.js';

// Interceptors
export { TenantContextInterceptor, TenantLoggingInterceptor } from './interceptors.js';

// Providers
export { createTenantProviders, createAsyncProviders } from './providers.js';

// Constants
export {
  TENANT_MANAGER,
  TENANT_DB,
  SHARED_DB,
  TENANT_CONTEXT,
  TENANT_MODULE_OPTIONS,
  TENANT_ID_EXTRACTOR,
  REQUIRES_TENANT_KEY,
  IS_PUBLIC_KEY,
} from './constants.js';

// Types
export type {
  TenantIdExtractor,
  TenantValidator,
  NestTenantContext,
  TenantModuleOptions,
  TenantModuleOptionsFactory,
  TenantModuleAsyncOptions,
  TenantRequest,
  TenantManager,
  TenantDb,
  SharedDb,
  Config,
} from './types.js';
