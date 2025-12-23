import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
  FastifyInstance,
} from 'fastify';
import fp from 'fastify-plugin';
import type { TenantManager } from '../types.js';
import { createTenantContext, type TenantContext, type TenantContextData } from '../context.js';

/**
 * Fastify plugin options
 */
export interface FastifyPluginOptions<
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
   * extractTenantId: (req) => (req.params as any).tenantId
   *
   * // From subdomain
   * extractTenantId: (req) => req.hostname.split('.')[0]
   */
  extractTenantId: (req: FastifyRequest) => string | undefined | Promise<string | undefined>;

  /**
   * Optional tenant validation
   * Throw an error or return false to reject the request
   */
  validateTenant?: (tenantId: string, req: FastifyRequest) => boolean | Promise<boolean>;

  /**
   * Enrich context with additional data
   */
  enrichContext?: (tenantId: string, req: FastifyRequest) => TCustom | Promise<TCustom>;

  /**
   * Custom error handler
   */
  onError?: (error: Error, req: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
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
 * Fastify request decorator
 */
declare module 'fastify' {
  interface FastifyRequest {
    tenantContext?: TenantContextData<Record<string, unknown>>;
  }
}

/**
 * Create Fastify plugin for tenant context
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { createTenantManager } from 'drizzle-multitenant';
 * import { createFastifyPlugin } from 'drizzle-multitenant/fastify';
 *
 * const fastify = Fastify();
 * const manager = createTenantManager(config);
 *
 * const { plugin, context } = createFastifyPlugin({
 *   manager,
 *   extractTenantId: (req) => req.headers['x-tenant-id'] as string,
 * });
 *
 * await fastify.register(plugin);
 *
 * fastify.get('/users', async (req, reply) => {
 *   const db = context.getTenantDb();
 *   const users = await db.select().from(schema.users);
 *   return users;
 * });
 * ```
 */
export function createFastifyPlugin<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
  TCustom extends Record<string, unknown> = Record<string, unknown>,
>(
  options: FastifyPluginOptions<TTenantSchema, TSharedSchema, TCustom>
): {
  plugin: FastifyPluginAsync;
  context: TenantContext<TTenantSchema, TSharedSchema, TCustom>;
} {
  const { manager, extractTenantId, validateTenant, enrichContext, onError } = options;

  const tenantContext = createTenantContext<TTenantSchema, TSharedSchema, TCustom>(manager);

  const defaultErrorHandler = async (
    error: Error,
    _req: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    if (error instanceof TenantNotFoundError) {
      reply.status(400).send({ error: 'Tenant ID is required' });
      return;
    }
    if (error instanceof TenantValidationError) {
      reply.status(403).send({ error: 'Invalid tenant' });
      return;
    }
    reply.status(500).send({ error: 'Internal server error' });
  };

  const errorHandler = onError ?? defaultErrorHandler;

  const pluginImpl: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
    // Decorate request with tenantContext
    fastify.decorateRequest('tenantContext', undefined);

    // Add preHandler hook to set tenant context
    fastify.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
      let tenantId: string | undefined;

      try {
        tenantId = await extractTenantId(req);
      } catch (error) {
        await errorHandler(error as Error, req, reply);
        throw error; // Re-throw to stop processing
      }

      if (!tenantId) {
        const error = new TenantNotFoundError('Tenant ID not found in request');
        await errorHandler(error, req, reply);
        throw error;
      }

      if (validateTenant) {
        try {
          const isValid = await validateTenant(tenantId, req);
          if (!isValid) {
            const error = new TenantValidationError(`Tenant ${tenantId} validation failed`);
            await errorHandler(error, req, reply);
            throw error;
          }
        } catch (error) {
          if (!(error instanceof TenantValidationError)) {
            await errorHandler(error as Error, req, reply);
          }
          throw error;
        }
      }

      const customContext = enrichContext ? await enrichContext(tenantId, req) : ({} as TCustom);

      const context: TenantContextData<TCustom> = {
        tenantId,
        ...customContext,
      };

      req.tenantContext = context;
    });
  };

  // Use fastify-plugin to make the plugin global (not encapsulated)
  const plugin = fp(pluginImpl, {
    name: 'drizzle-multitenant',
  });

  return { plugin, context: tenantContext };
}

/**
 * Re-export context utilities for convenience
 */
export { createTenantContext, type TenantContext, type TenantContextData } from '../context.js';
