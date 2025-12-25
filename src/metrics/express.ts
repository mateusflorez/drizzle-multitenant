/**
 * Express metrics endpoint middleware
 * @module drizzle-multitenant/metrics
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { TenantManager } from '../types.js';
import type { MetricsEndpointOptions } from './types.js';
import { MetricsCollector } from './collector.js';
import { PrometheusExporter } from './prometheus.js';

/**
 * Create an Express middleware that exposes Prometheus metrics
 *
 * @param tenantManager - The tenant manager to collect metrics from
 * @param options - Endpoint configuration options
 * @returns Express request handler
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createTenantManager } from 'drizzle-multitenant';
 * import { createMetricsMiddleware } from 'drizzle-multitenant/metrics';
 *
 * const app = express();
 * const manager = createTenantManager(config);
 *
 * // Basic usage
 * app.use('/metrics', createMetricsMiddleware(manager));
 *
 * // With options
 * app.use('/metrics', createMetricsMiddleware(manager, {
 *   prefix: 'myapp',
 *   includeRuntime: true,
 *   auth: { username: 'prometheus', password: 'secret' },
 * }));
 * ```
 */
export function createMetricsMiddleware<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  tenantManager: TenantManager<TTenantSchema, TSharedSchema>,
  options: MetricsEndpointOptions = {}
): RequestHandler {
  const collector = new MetricsCollector(tenantManager);
  const exporter = new PrometheusExporter({
    prefix: options.prefix,
    includeTenantLabels: options.includeTenantLabels,
    includeTimestamps: options.includeTimestamps,
    defaultLabels: options.defaultLabels,
  });

  const { auth, includeRuntime = false } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Basic auth check if configured
      if (auth) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
          res.setHeader('WWW-Authenticate', 'Basic realm="Metrics"');
          res.status(401).send('Authentication required');
          return;
        }

        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
        const [username, password] = credentials.split(':');

        if (username !== auth.username || password !== auth.password) {
          res.status(403).send('Invalid credentials');
          return;
        }
      }

      // Collect metrics
      const metrics = await collector.collect({ includeHealth: true });
      const runtime = includeRuntime ? collector.getRuntimeMetrics() : undefined;

      // Export and send
      const text = exporter.export(metrics, runtime);

      res.setHeader('Content-Type', PrometheusExporter.contentType);
      res.send(text);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Create an Express route handler for metrics (alternative to middleware)
 *
 * @param tenantManager - The tenant manager to collect metrics from
 * @param options - Endpoint configuration options
 * @returns Express request handler
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createMetricsHandler } from 'drizzle-multitenant/metrics';
 *
 * const app = express();
 *
 * // Mount at any path
 * app.get('/api/metrics', createMetricsHandler(manager));
 * app.get('/health/prometheus', createMetricsHandler(manager, { includeRuntime: true }));
 * ```
 */
export function createMetricsHandler<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  tenantManager: TenantManager<TTenantSchema, TSharedSchema>,
  options: Omit<MetricsEndpointOptions, 'path'> = {}
): RequestHandler {
  // Same implementation as middleware, just a different semantic name
  return createMetricsMiddleware(tenantManager, options);
}
