import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { TenantManager } from '../types.js';
import { createTenantContext, type TenantContext, type TenantContextData } from '../context.js';

/**
 * Express middleware options
 */
export interface ExpressMiddlewareOptions<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
  TCustom extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Tenant manager instance */
  manager: TenantManager<TTenantSchema, TSharedSchema>;

  /**
   * Extract tenant ID from request
   * @example
   * // From header
   * extractTenantId: (req) => req.headers['x-tenant-id'] as string
   *
   * // From path param
   * extractTenantId: (req) => req.params.tenantId
   *
   * // From subdomain
   * extractTenantId: (req) => req.hostname.split('.')[0]
   */
  extractTenantId: (req: Request) => string | undefined | Promise<string | undefined>;

  /**
   * Optional tenant validation
   * Throw an error or return false to reject the request
   */
  validateTenant?: (tenantId: string, req: Request) => boolean | Promise<boolean>;

  /**
   * Enrich context with additional data
   */
  enrichContext?: (tenantId: string, req: Request) => TCustom | Promise<TCustom>;

  /**
   * Custom error handler
   */
  onError?: (error: Error, req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Tenant not found error
 */
export class TenantNotFoundError extends Error {
  constructor(message = 'Tenant not found') {
    super(message);
    this.name = 'TenantNotFoundError';
  }
}

/**
 * Tenant validation error
 */
export class TenantValidationError extends Error {
  constructor(message = 'Tenant validation failed') {
    super(message);
    this.name = 'TenantValidationError';
  }
}

/**
 * Extended Express Request with tenant context
 */
export interface TenantRequest<TCustom extends Record<string, unknown> = Record<string, unknown>>
  extends Request {
  tenantContext?: TenantContextData<TCustom>;
}

/**
 * Create Express middleware for tenant context
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createTenantManager } from 'drizzle-multitenant';
 * import { createExpressMiddleware } from 'drizzle-multitenant/express';
 *
 * const app = express();
 * const manager = createTenantManager(config);
 *
 * const tenantMiddleware = createExpressMiddleware({
 *   manager,
 *   extractTenantId: (req) => req.headers['x-tenant-id'] as string,
 *   validateTenant: async (tenantId) => {
 *     // Check if tenant exists in database
 *     return true;
 *   },
 * });
 *
 * app.use('/api', tenantMiddleware);
 *
 * app.get('/api/users', async (req, res) => {
 *   const db = getTenantDb();
 *   const users = await db.select().from(schema.users);
 *   res.json(users);
 * });
 * ```
 */
export function createExpressMiddleware<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
  TCustom extends Record<string, unknown> = Record<string, unknown>,
>(
  options: ExpressMiddlewareOptions<TTenantSchema, TSharedSchema, TCustom>
): RequestHandler & {
  context: TenantContext<TTenantSchema, TSharedSchema, TCustom>;
} {
  const { manager, extractTenantId, validateTenant, enrichContext, onError } = options;

  const tenantContext = createTenantContext<TTenantSchema, TSharedSchema, TCustom>(manager);

  const defaultErrorHandler = (
    error: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
  ): void => {
    if (error instanceof TenantNotFoundError) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }
    if (error instanceof TenantValidationError) {
      res.status(403).json({ error: 'Invalid tenant' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  };

  const errorHandler = onError ?? defaultErrorHandler;

  const middleware: RequestHandler = async (
    req: TenantRequest<TCustom>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const tenantId = await extractTenantId(req);

      if (!tenantId) {
        throw new TenantNotFoundError('Tenant ID not found in request');
      }

      if (validateTenant) {
        const isValid = await validateTenant(tenantId, req);
        if (!isValid) {
          throw new TenantValidationError(`Tenant ${tenantId} validation failed`);
        }
      }

      const customContext = enrichContext ? await enrichContext(tenantId, req) : ({} as TCustom);

      const context: TenantContextData<TCustom> = {
        tenantId,
        ...customContext,
      };

      req.tenantContext = context;

      await tenantContext.runWithTenant(context, async () => {
        await new Promise<void>((resolve, reject) => {
          next();
          res.on('finish', resolve);
          res.on('error', reject);
        });
      });
    } catch (error) {
      errorHandler(error as Error, req, res, next);
    }
  };

  return Object.assign(middleware, { context: tenantContext });
}

/**
 * Re-export context utilities for convenience
 */
export { createTenantContext, type TenantContext, type TenantContextData } from '../context.js';
