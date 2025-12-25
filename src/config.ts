import type { Config } from './types.js';

/**
 * Define configuration for drizzle-multitenant
 *
 * @example
 * ```typescript
 * import { defineConfig } from 'drizzle-multitenant';
 * import * as tenantSchema from './schemas/tenant';
 * import * as sharedSchema from './schemas/shared';
 *
 * export default defineConfig({
 *   connection: {
 *     url: process.env.DATABASE_URL!,
 *     poolConfig: {
 *       max: 10,
 *       idleTimeoutMillis: 30000,
 *     },
 *   },
 *   isolation: {
 *     strategy: 'schema',
 *     schemaNameTemplate: (tenantId) => `tenant_${tenantId.replace(/-/g, '_')}`,
 *     maxPools: 50,
 *     poolTtlMs: 60 * 60 * 1000,
 *   },
 *   schemas: {
 *     tenant: tenantSchema,
 *     shared: sharedSchema,
 *   },
 * });
 * ```
 */
export function defineConfig<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(config: Config<TTenantSchema, TSharedSchema>): Config<TTenantSchema, TSharedSchema> {
  validateConfig(config);
  return config;
}

/**
 * Validate configuration at runtime
 */
function validateConfig<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
>(config: Config<TTenantSchema, TSharedSchema>): void {
  // Connection validation
  if (!config.connection.url) {
    throw new Error('[drizzle-multitenant] connection.url is required');
  }

  // Isolation validation
  if (!config.isolation.strategy) {
    throw new Error('[drizzle-multitenant] isolation.strategy is required');
  }

  if (config.isolation.strategy !== 'schema') {
    throw new Error(
      `[drizzle-multitenant] isolation.strategy "${config.isolation.strategy}" is not yet supported. Only "schema" is currently available.`
    );
  }

  if (!config.isolation.schemaNameTemplate) {
    throw new Error('[drizzle-multitenant] isolation.schemaNameTemplate is required');
  }

  if (typeof config.isolation.schemaNameTemplate !== 'function') {
    throw new Error('[drizzle-multitenant] isolation.schemaNameTemplate must be a function');
  }

  // Schema validation
  if (!config.schemas.tenant) {
    throw new Error('[drizzle-multitenant] schemas.tenant is required');
  }

  // Pool limits validation
  if (config.isolation.maxPools !== undefined && config.isolation.maxPools < 1) {
    throw new Error('[drizzle-multitenant] isolation.maxPools must be at least 1');
  }

  if (config.isolation.poolTtlMs !== undefined && config.isolation.poolTtlMs < 0) {
    throw new Error('[drizzle-multitenant] isolation.poolTtlMs must be non-negative');
  }

  // Retry config validation
  if (config.connection.retry) {
    const retry = config.connection.retry;

    if (retry.maxAttempts !== undefined && retry.maxAttempts < 1) {
      throw new Error('[drizzle-multitenant] connection.retry.maxAttempts must be at least 1');
    }

    if (retry.initialDelayMs !== undefined && retry.initialDelayMs < 0) {
      throw new Error('[drizzle-multitenant] connection.retry.initialDelayMs must be non-negative');
    }

    if (retry.maxDelayMs !== undefined && retry.maxDelayMs < 0) {
      throw new Error('[drizzle-multitenant] connection.retry.maxDelayMs must be non-negative');
    }

    if (retry.backoffMultiplier !== undefined && retry.backoffMultiplier < 1) {
      throw new Error('[drizzle-multitenant] connection.retry.backoffMultiplier must be at least 1');
    }

    if (
      retry.initialDelayMs !== undefined &&
      retry.maxDelayMs !== undefined &&
      retry.initialDelayMs > retry.maxDelayMs
    ) {
      throw new Error(
        '[drizzle-multitenant] connection.retry.initialDelayMs cannot be greater than maxDelayMs'
      );
    }
  }
}
