import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantManager, TenantDb, SharedDb } from './types.js';

/**
 * Base tenant context data
 */
export interface BaseTenantContext {
  tenantId: string;
}

/**
 * Tenant context with optional custom data
 */
export type TenantContextData<TCustom extends Record<string, unknown> = Record<string, unknown>> =
  BaseTenantContext & TCustom;

/**
 * Tenant context API
 */
export interface TenantContext<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
  TCustom extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Run a callback with tenant context
   */
  runWithTenant<T>(
    context: TenantContextData<TCustom>,
    callback: () => T | Promise<T>
  ): T | Promise<T>;

  /**
   * Get current tenant context (throws if not in context)
   */
  getTenant(): TenantContextData<TCustom>;

  /**
   * Get current tenant context or undefined
   */
  getTenantOrNull(): TenantContextData<TCustom> | undefined;

  /**
   * Get current tenant ID (throws if not in context)
   */
  getTenantId(): string;

  /**
   * Get database for current tenant (throws if not in context)
   */
  getTenantDb(): TenantDb<TTenantSchema>;

  /**
   * Get shared database
   */
  getSharedDb(): SharedDb<TSharedSchema>;

  /**
   * Check if currently running within a tenant context
   */
  isInTenantContext(): boolean;
}

/**
 * Create a tenant context with AsyncLocalStorage
 *
 * @example
 * ```typescript
 * import { createTenantContext, createTenantManager } from 'drizzle-multitenant';
 *
 * const manager = createTenantManager(config);
 *
 * const {
 *   runWithTenant,
 *   getTenant,
 *   getTenantDb,
 *   getSharedDb,
 * } = createTenantContext(manager);
 *
 * // Use in request handler
 * app.get('/users', async (req, res) => {
 *   const tenantId = req.headers['x-tenant-id'];
 *
 *   await runWithTenant({ tenantId }, async () => {
 *     const db = getTenantDb();
 *     const users = await db.select().from(schema.users);
 *     res.json(users);
 *   });
 * });
 * ```
 */
export function createTenantContext<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
  TCustom extends Record<string, unknown> = Record<string, unknown>,
>(
  manager: TenantManager<TTenantSchema, TSharedSchema>
): TenantContext<TTenantSchema, TSharedSchema, TCustom> {
  const storage = new AsyncLocalStorage<TenantContextData<TCustom>>();

  function getTenantOrNull(): TenantContextData<TCustom> | undefined {
    return storage.getStore();
  }

  function getTenant(): TenantContextData<TCustom> {
    const context = getTenantOrNull();
    if (!context) {
      throw new Error(
        '[drizzle-multitenant] No tenant context found. ' +
          'Make sure you are calling this within runWithTenant().'
      );
    }
    return context;
  }

  function getTenantId(): string {
    return getTenant().tenantId;
  }

  function getTenantDb(): TenantDb<TTenantSchema> {
    const tenantId = getTenantId();
    return manager.getDb(tenantId);
  }

  function getSharedDb(): SharedDb<TSharedSchema> {
    return manager.getSharedDb();
  }

  function isInTenantContext(): boolean {
    return getTenantOrNull() !== undefined;
  }

  function runWithTenant<T>(
    context: TenantContextData<TCustom>,
    callback: () => T | Promise<T>
  ): T | Promise<T> {
    if (!context.tenantId) {
      throw new Error('[drizzle-multitenant] tenantId is required in context');
    }
    return storage.run(context, callback);
  }

  return {
    runWithTenant,
    getTenant,
    getTenantOrNull,
    getTenantId,
    getTenantDb,
    getSharedDb,
    isInTenantContext,
  };
}
