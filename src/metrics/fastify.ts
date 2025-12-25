/**
 * Fastify metrics endpoint plugin
 * @module drizzle-multitenant/metrics
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { TenantManager } from '../types.js';
import type { MetricsEndpointOptions } from './types.js';
import { MetricsCollector } from './collector.js';
import { PrometheusExporter } from './prometheus.js';

/**
 * Fastify metrics plugin options
 */
export interface FastifyMetricsPluginOptions<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> extends MetricsEndpointOptions {
  /** Tenant manager to collect metrics from */
  tenantManager: TenantManager<TTenantSchema, TSharedSchema>;
}

/**
 * Fastify plugin that exposes Prometheus metrics endpoint
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { createTenantManager } from 'drizzle-multitenant';
 * import { fastifyMetricsPlugin } from 'drizzle-multitenant/metrics';
 *
 * const fastify = Fastify();
 * const manager = createTenantManager(config);
 *
 * // Register plugin
 * await fastify.register(fastifyMetricsPlugin, {
 *   tenantManager: manager,
 *   path: '/metrics',
 *   prefix: 'myapp',
 *   includeRuntime: true,
 * });
 * ```
 */
async function metricsPlugin<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  fastify: FastifyInstance,
  options: FastifyMetricsPluginOptions<TTenantSchema, TSharedSchema>
): Promise<void> {
  const {
    tenantManager,
    path = '/metrics',
    auth,
    includeRuntime = false,
    prefix,
    includeTenantLabels,
    includeTimestamps,
    defaultLabels,
  } = options;

  const collector = new MetricsCollector(tenantManager);
  const exporter = new PrometheusExporter({
    prefix,
    includeTenantLabels,
    includeTimestamps,
    defaultLabels,
  });

  // Add preHandler for auth if configured
  const preHandler = auth
    ? async (request: FastifyRequest, reply: FastifyReply) => {
        const authHeader = request.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Basic ')) {
          reply.header('WWW-Authenticate', 'Basic realm="Metrics"');
          reply.code(401).send('Authentication required');
          return;
        }

        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
        const [username, password] = credentials.split(':');

        if (username !== auth.username || password !== auth.password) {
          reply.code(403).send('Invalid credentials');
          return;
        }
      }
    : undefined;

  // Build route options
  const routeOptions = {
    schema: {
      description: 'Prometheus metrics endpoint',
      tags: ['monitoring'],
      response: {
        200: {
          description: 'Prometheus text exposition format',
          type: 'string',
        },
      },
    },
    ...(preHandler && { preHandler }),
  };

  // Register the metrics route
  fastify.get(
    path,
    routeOptions,
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const metrics = await collector.collect({ includeHealth: true });
      const runtime = includeRuntime ? collector.getRuntimeMetrics() : undefined;
      const text = exporter.export(metrics, runtime);

      reply.header('Content-Type', PrometheusExporter.contentType);
      return text;
    }
  );

  // Decorate fastify with metrics utilities
  fastify.decorate('metricsCollector', collector);
  fastify.decorate('metricsExporter', exporter);
}

/**
 * Fastify metrics plugin (wrapped with fastify-plugin)
 */
export const fastifyMetricsPlugin = fp(metricsPlugin, {
  fastify: '>=4.0.0',
  name: 'drizzle-multitenant-metrics',
});

/**
 * Create a metrics route handler for Fastify
 *
 * Alternative to using the plugin, useful when you want more control.
 *
 * @param tenantManager - The tenant manager to collect metrics from
 * @param options - Endpoint configuration options
 * @returns Route handler function
 *
 * @example
 * ```typescript
 * import Fastify from 'fastify';
 * import { createFastifyMetricsHandler } from 'drizzle-multitenant/metrics';
 *
 * const fastify = Fastify();
 * const handler = createFastifyMetricsHandler(manager, { includeRuntime: true });
 *
 * fastify.get('/metrics', handler);
 * ```
 */
export function createFastifyMetricsHandler<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  tenantManager: TenantManager<TTenantSchema, TSharedSchema>,
  options: Omit<MetricsEndpointOptions, 'path' | 'auth'> = {}
): (request: FastifyRequest, reply: FastifyReply) => Promise<string> {
  const collector = new MetricsCollector(tenantManager);
  const exporter = new PrometheusExporter({
    prefix: options.prefix,
    includeTenantLabels: options.includeTenantLabels,
    includeTimestamps: options.includeTimestamps,
    defaultLabels: options.defaultLabels,
  });

  const { includeRuntime = false } = options;

  return async (_request: FastifyRequest, reply: FastifyReply) => {
    const metrics = await collector.collect({ includeHealth: true });
    const runtime = includeRuntime ? collector.getRuntimeMetrics() : undefined;
    const text = exporter.export(metrics, runtime);

    reply.header('Content-Type', PrometheusExporter.contentType);
    return text;
  };
}

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    metricsCollector: MetricsCollector;
    metricsExporter: PrometheusExporter;
  }
}
