// Core exports
export { defineConfig } from './config.js';
export { createTenantManager } from './manager.js';

// Types
export type {
  Config,
  ConnectionConfig,
  IsolationConfig,
  IsolationStrategy,
  SchemasConfig,
  Hooks,
  MetricsConfig,
  TenantManager,
  TenantDb,
  SharedDb,
  PoolEntry,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';
