import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TenantManager, MetricsResult, HealthCheckResult } from '../types.js';
import { MetricsCollector, createMetricsCollector } from './collector.js';
import { PrometheusExporter, createPrometheusExporter } from './prometheus.js';

// Mock tenant manager
function createMockTenantManager(overrides: Partial<TenantManager> = {}): TenantManager {
  const defaultMetrics: MetricsResult = {
    pools: {
      total: 3,
      maxPools: 50,
      tenants: [
        {
          tenantId: 'tenant-1',
          schemaName: 'tenant_1',
          connections: { total: 10, idle: 5, waiting: 0 },
          lastAccessedAt: '2025-01-01T00:00:00.000Z',
        },
        {
          tenantId: 'tenant-2',
          schemaName: 'tenant_2',
          connections: { total: 10, idle: 8, waiting: 2 },
          lastAccessedAt: '2025-01-01T00:01:00.000Z',
        },
        {
          tenantId: 'tenant-3',
          schemaName: 'tenant_3',
          connections: { total: 5, idle: 3, waiting: 0 },
          lastAccessedAt: '2025-01-01T00:02:00.000Z',
        },
      ],
    },
    shared: {
      initialized: true,
      connections: { total: 10, idle: 8, waiting: 0 },
    },
    timestamp: '2025-01-01T00:00:00.000Z',
  };

  const defaultHealthCheck: HealthCheckResult = {
    healthy: true,
    pools: [
      {
        tenantId: 'tenant-1',
        schemaName: 'tenant_1',
        status: 'ok',
        totalConnections: 10,
        idleConnections: 5,
        waitingRequests: 0,
        responseTimeMs: 5,
      },
      {
        tenantId: 'tenant-2',
        schemaName: 'tenant_2',
        status: 'degraded',
        totalConnections: 10,
        idleConnections: 8,
        waitingRequests: 2,
        responseTimeMs: 15,
      },
      {
        tenantId: 'tenant-3',
        schemaName: 'tenant_3',
        status: 'ok',
        totalConnections: 5,
        idleConnections: 3,
        waitingRequests: 0,
        responseTimeMs: 3,
      },
    ],
    sharedDb: 'ok',
    sharedDbResponseTimeMs: 2,
    totalPools: 3,
    degradedPools: 1,
    unhealthyPools: 0,
    timestamp: '2025-01-01T00:00:00.000Z',
    durationMs: 50,
  };

  return {
    getDb: vi.fn(),
    getDbAsync: vi.fn(),
    getSharedDb: vi.fn(),
    getSharedDbAsync: vi.fn(),
    getSchemaName: vi.fn((id) => `tenant_${id}`),
    hasPool: vi.fn(),
    getPoolCount: vi.fn(() => 3),
    getActiveTenantIds: vi.fn(() => ['tenant-1', 'tenant-2', 'tenant-3']),
    getRetryConfig: vi.fn(),
    evictPool: vi.fn(),
    warmup: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(defaultHealthCheck),
    getMetrics: vi.fn().mockReturnValue(defaultMetrics),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as TenantManager;
}

describe('MetricsCollector', () => {
  let manager: TenantManager;
  let collector: MetricsCollector;

  beforeEach(() => {
    manager = createMockTenantManager();
    collector = new MetricsCollector(manager);
  });

  describe('collect', () => {
    it('should collect pool metrics without health check by default', async () => {
      const result = await collector.collect();

      expect(result.pools).toBeDefined();
      expect(result.pools.pools.total).toBe(3);
      expect(result.health).toBeUndefined();
      expect(result.collectedAt).toBeDefined();
      expect(manager.getMetrics).toHaveBeenCalled();
      expect(manager.healthCheck).not.toHaveBeenCalled();
    });

    it('should include health check when requested', async () => {
      const result = await collector.collect({ includeHealth: true });

      expect(result.pools).toBeDefined();
      expect(result.health).toBeDefined();
      expect(result.health?.healthy).toBe(true);
      expect(result.health?.totalPools).toBe(3);
      expect(manager.healthCheck).toHaveBeenCalled();
    });

    it('should pass tenant IDs to health check', async () => {
      await collector.collect({
        includeHealth: true,
        tenantIds: ['tenant-1', 'tenant-2'],
      });

      expect(manager.healthCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantIds: ['tenant-1', 'tenant-2'],
        })
      );
    });

    it('should use custom ping timeout', async () => {
      await collector.collect({
        includeHealth: true,
        healthPingTimeoutMs: 10000,
      });

      expect(manager.healthCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          pingTimeoutMs: 10000,
        })
      );
    });
  });

  describe('getPoolMetrics', () => {
    it('should return pool metrics directly', () => {
      const metrics = collector.getPoolMetrics();

      expect(metrics.pools.total).toBe(3);
      expect(metrics.pools.tenants).toHaveLength(3);
      expect(manager.getMetrics).toHaveBeenCalled();
    });
  });

  describe('getHealthMetrics', () => {
    it('should return health check results', async () => {
      const health = await collector.getHealthMetrics();

      expect(health.healthy).toBe(true);
      expect(health.totalPools).toBe(3);
      expect(health.degradedPools).toBe(1);
    });
  });

  describe('getRuntimeMetrics', () => {
    it('should return Node.js runtime metrics', () => {
      const runtime = collector.getRuntimeMetrics();

      expect(runtime.uptimeSeconds).toBeGreaterThan(0);
      expect(runtime.memoryUsage.heapTotal).toBeGreaterThan(0);
      expect(runtime.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(runtime.memoryUsage.rss).toBeGreaterThan(0);
      expect(typeof runtime.activeHandles).toBe('number');
      expect(typeof runtime.activeRequests).toBe('number');
    });
  });

  describe('calculateSummary', () => {
    it('should calculate summary without health', async () => {
      const metrics = await collector.collect();
      const summary = collector.calculateSummary(metrics);

      expect(summary.activePools).toBe(3);
      expect(summary.totalConnections).toBe(35); // 10+10+5+10 (shared)
      expect(summary.idleConnections).toBe(24); // 5+8+3+8 (shared)
      expect(summary.waitingRequests).toBe(2); // 0+2+0+0 (shared)
      expect(summary.healthyPools).toBe(3); // All healthy when no health check
      expect(summary.degradedPools).toBe(0);
      expect(summary.unhealthyPools).toBe(0);
    });

    it('should calculate summary with health', async () => {
      const metrics = await collector.collect({ includeHealth: true });
      const summary = collector.calculateSummary(metrics);

      expect(summary.healthyPools).toBe(2); // tenant-1, tenant-3
      expect(summary.degradedPools).toBe(1); // tenant-2
      expect(summary.unhealthyPools).toBe(0);
    });
  });
});

describe('createMetricsCollector', () => {
  it('should create a MetricsCollector instance', () => {
    const manager = createMockTenantManager();
    const collector = createMetricsCollector(manager);

    expect(collector).toBeInstanceOf(MetricsCollector);
  });
});

describe('PrometheusExporter', () => {
  let manager: TenantManager;
  let collector: MetricsCollector;
  let exporter: PrometheusExporter;

  beforeEach(() => {
    manager = createMockTenantManager();
    collector = new MetricsCollector(manager);
    exporter = new PrometheusExporter();
  });

  describe('export', () => {
    it('should export metrics in Prometheus text format', async () => {
      const metrics = await collector.collect();
      const text = exporter.export(metrics);

      expect(text).toContain('# HELP');
      expect(text).toContain('# TYPE');
      expect(text).toContain('drizzle_multitenant_pools_active');
      expect(text).toContain('drizzle_multitenant_pools_max');
      expect(text).toContain('drizzle_multitenant_pool_connections_total');
    });

    it('should include tenant labels', async () => {
      const metrics = await collector.collect();
      const text = exporter.export(metrics);

      expect(text).toContain('tenant="tenant-1"');
      expect(text).toContain('schema="tenant_1"');
    });

    it('should include health metrics when available', async () => {
      const metrics = await collector.collect({ includeHealth: true });
      const text = exporter.export(metrics);

      expect(text).toContain('drizzle_multitenant_health_status');
      expect(text).toContain('drizzle_multitenant_health_pools_total');
      expect(text).toContain('drizzle_multitenant_health_pools_degraded');
      expect(text).toContain('drizzle_multitenant_pool_health_status');
      expect(text).toContain('drizzle_multitenant_pool_response_time_seconds');
    });

    it('should use custom prefix', async () => {
      const customExporter = new PrometheusExporter({ prefix: 'myapp' });
      const metrics = await collector.collect();
      const text = customExporter.export(metrics);

      expect(text).toContain('myapp_pools_active');
      expect(text).not.toContain('drizzle_multitenant_');
    });

    it('should add default labels', async () => {
      const customExporter = new PrometheusExporter({
        defaultLabels: { env: 'production', app: 'test' },
      });
      const metrics = await collector.collect();
      const text = customExporter.export(metrics);

      expect(text).toContain('env="production"');
      expect(text).toContain('app="test"');
    });

    it('should exclude tenant labels when disabled', async () => {
      const customExporter = new PrometheusExporter({ includeTenantLabels: false });
      const metrics = await collector.collect();
      const text = customExporter.export(metrics);

      // Should still have the metric but without tenant labels
      expect(text).toContain('drizzle_multitenant_pools_active');
      expect(text).not.toContain('tenant="tenant-1"');
    });

    it('should include runtime metrics when provided', async () => {
      const metrics = await collector.collect();
      const runtime = collector.getRuntimeMetrics();
      const text = exporter.export(metrics, runtime);

      expect(text).toContain('drizzle_multitenant_process_uptime_seconds');
      expect(text).toContain('drizzle_multitenant_process_heap_bytes_total');
      expect(text).toContain('drizzle_multitenant_process_heap_bytes_used');
      expect(text).toContain('drizzle_multitenant_process_rss_bytes');
    });

    it('should properly escape label values', async () => {
      const customManager = createMockTenantManager({
        getMetrics: vi.fn().mockReturnValue({
          pools: {
            total: 1,
            maxPools: 50,
            tenants: [
              {
                tenantId: 'tenant-with"quotes',
                schemaName: 'tenant_with_quotes',
                connections: { total: 10, idle: 5, waiting: 0 },
                lastAccessedAt: '2025-01-01T00:00:00.000Z',
              },
            ],
          },
          shared: { initialized: false, connections: null },
          timestamp: '2025-01-01T00:00:00.000Z',
        }),
      });

      const customCollector = new MetricsCollector(customManager);
      const metrics = await customCollector.collect();
      const text = exporter.export(metrics);

      expect(text).toContain('tenant="tenant-with\\"quotes"');
    });
  });

  describe('toPrometheusMetrics', () => {
    it('should convert aggregated metrics to prometheus metrics', async () => {
      const metrics = await collector.collect();
      const prometheusMetrics = exporter.toPrometheusMetrics(metrics);

      expect(prometheusMetrics.length).toBeGreaterThan(0);

      const poolsActive = prometheusMetrics.find((m) => m.name.includes('pools_active'));
      expect(poolsActive).toBeDefined();
      expect(poolsActive?.type).toBe('gauge');
      expect(poolsActive?.values[0].value).toBe(3);
    });
  });

  describe('contentType', () => {
    it('should return correct content type', () => {
      expect(PrometheusExporter.contentType).toBe(
        'text/plain; version=0.0.4; charset=utf-8'
      );
    });
  });
});

describe('createPrometheusExporter', () => {
  it('should create a PrometheusExporter instance', () => {
    const exporter = createPrometheusExporter();
    expect(exporter).toBeInstanceOf(PrometheusExporter);
  });

  it('should pass options to the exporter', () => {
    const exporter = createPrometheusExporter({ prefix: 'custom' });
    expect(exporter).toBeInstanceOf(PrometheusExporter);
  });
});
