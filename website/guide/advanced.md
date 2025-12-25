# Advanced Features

## Pool Warmup

Pre-warm pools during startup to eliminate cold start latency:

```typescript
const tenants = createTenantManager(config);

// Warmup specific tenants
const result = await tenants.warmup(['tenant-1', 'tenant-2', 'tenant-3']);
console.log(`Warmed ${result.succeeded} pools in ${result.durationMs}ms`);

// With options
await tenants.warmup(tenantIds, {
  concurrency: 5,
  ping: true,
  onProgress: (id, status) => console.log(`${id}: ${status}`),
});
```

### NestJS Integration

```typescript
@Injectable()
export class WarmupService implements OnApplicationBootstrap {
  constructor(@InjectTenantManager() private manager: TenantManager) {}

  async onApplicationBootstrap() {
    const topTenants = await this.getTopTenants();
    const result = await this.manager.warmup(topTenants);
    console.log(`Warmed ${result.succeeded} pools`);
  }
}
```

### WarmupResult

```typescript
interface WarmupResult {
  total: number;
  succeeded: number;
  failed: number;
  alreadyWarm: number;
  durationMs: number;
  details: TenantWarmupResult[];
}
```

## Connection Retry

Automatic retry with exponential backoff for transient failures:

```typescript
export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
      onRetry: (attempt, error, delay) => {
        console.log(`Retry ${attempt}: ${error.message}, waiting ${delay}ms`);
      },
    },
  },
});
```

### Async Methods with Retry

```typescript
// With retry and connection validation
const db = await tenants.getDbAsync('tenant-123');
const sharedDb = await tenants.getSharedDbAsync();

// Sync version (no retry, backward compatible)
const dbSync = tenants.getDb('tenant-123');
```

### Retryable Errors

Automatically retried:
- Connection errors: `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`
- PostgreSQL transient: `too many connections`, `database system is starting up`
- SSL/TLS errors, socket hang up

Not retried (fail immediately):
- Syntax errors, permission denied, authentication failed

### Custom Retry Logic

```typescript
import { withRetry, createRetrier } from 'drizzle-multitenant';

// One-off retry
const result = await withRetry(
  () => someAsyncOperation(),
  { maxAttempts: 5, initialDelayMs: 200 }
);

// Reusable retrier
const retrier = createRetrier({ maxAttempts: 3 });
const data = await retrier(() => fetchData());

// Custom retry condition
await withRetry(
  () => customOperation(),
  {
    isRetryable: (error) => error.code === 'CUSTOM_ERROR',
  }
);
```

## Debug Mode

Enable logging for development and troubleshooting:

```typescript
export default defineConfig({
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    logQueries: true,
    logPoolEvents: true,
    slowQueryThreshold: 1000,
  },
});
```

### Output

```
[drizzle-multitenant] tenant=abc POOL_CREATED schema=tenant_abc
[drizzle-multitenant] tenant=abc query="SELECT * FROM users..." duration=45ms
[drizzle-multitenant] tenant=abc SLOW_QUERY duration=1523ms query="..."
[drizzle-multitenant] tenant=abc POOL_EVICTED schema=tenant_abc reason=ttl_expired
[drizzle-multitenant] tenant=abc CONNECTION_RETRY attempt=1/3 delay=100ms error="ECONNREFUSED"
```

### Custom Logger

```typescript
import pino from 'pino';

const logger = pino();

export default defineConfig({
  debug: {
    enabled: true,
    logger: (message, context) => {
      if (context?.type === 'slow_query') {
        logger.warn({ ...context }, message);
      } else {
        logger.debug({ ...context }, message);
      }
    },
  },
});
```

### DebugContext

```typescript
interface DebugContext {
  type: 'query' | 'slow_query' | 'pool_created' | 'pool_evicted' | 'pool_error' | 'warmup' | 'connection_retry';
  tenantId?: string;
  schemaName?: string;
  query?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

## Health Checks

Verify the health of all pools and connections for monitoring and load balancer integration:

```typescript
const health = await tenants.healthCheck();

if (health.healthy) {
  console.log('All systems operational');
} else {
  console.log(`${health.unhealthyPools} pools are unhealthy`);
}
```

### Express Endpoint

```typescript
app.get('/health', async (req, res) => {
  const health = await tenants.healthCheck();
  res.status(health.healthy ? 200 : 503).json(health);
});
```

### Options

```typescript
await tenants.healthCheck({
  ping: true,              // Execute SELECT 1 to verify connection (default: true)
  pingTimeoutMs: 5000,     // Timeout for ping query (default: 5000)
  includeShared: true,     // Check shared database (default: true)
  tenantIds: ['t1', 't2'], // Check specific tenants only (optional)
});
```

### HealthCheckResult

```typescript
interface HealthCheckResult {
  healthy: boolean;              // Overall health status
  pools: PoolHealth[];           // Per-tenant pool health
  sharedDb: PoolHealthStatus;    // 'ok' | 'degraded' | 'unhealthy'
  sharedDbResponseTimeMs?: number;
  totalPools: number;
  degradedPools: number;
  unhealthyPools: number;
  timestamp: string;
  durationMs: number;
}

interface PoolHealth {
  tenantId: string;
  schemaName: string;
  status: 'ok' | 'degraded' | 'unhealthy';
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
  responseTimeMs?: number;
  error?: string;
}
```

### Health Status

| Status | Condition |
|--------|-----------|
| `ok` | Pool responding normally |
| `degraded` | Requests waiting in queue or slow response |
| `unhealthy` | Ping failed or timed out |

## Metrics

Collect metrics on demand with zero overhead. Data is returned in a format-agnostic structure that you can format for any monitoring system:

```typescript
const metrics = tenants.getMetrics();

console.log(`Active pools: ${metrics.pools.total}/${metrics.pools.maxPools}`);
```

### MetricsResult

```typescript
interface MetricsResult {
  pools: {
    total: number;
    maxPools: number;
    tenants: TenantPoolMetrics[];
  };
  shared: {
    initialized: boolean;
    connections: ConnectionMetrics | null;
  };
  timestamp: string;
}

interface TenantPoolMetrics {
  tenantId: string;
  schemaName: string;
  connections: ConnectionMetrics;
  lastAccessedAt: string;
}

interface ConnectionMetrics {
  total: number;
  idle: number;
  waiting: number;
}
```

### Prometheus Integration

```typescript
import { Gauge, register } from 'prom-client';

const poolGauge = new Gauge({
  name: 'drizzle_pool_count',
  help: 'Number of active tenant pools',
});

const connectionsGauge = new Gauge({
  name: 'drizzle_connections',
  help: 'Connection metrics by tenant',
  labelNames: ['tenant', 'state'],
});

app.get('/metrics', async (req, res) => {
  const metrics = tenants.getMetrics();

  poolGauge.set(metrics.pools.total);

  for (const pool of metrics.pools.tenants) {
    connectionsGauge.labels(pool.tenantId, 'total').set(pool.connections.total);
    connectionsGauge.labels(pool.tenantId, 'idle').set(pool.connections.idle);
    connectionsGauge.labels(pool.tenantId, 'waiting').set(pool.connections.waiting);
  }

  res.set('Content-Type', 'text/plain');
  res.send(await register.metrics());
});
```

### Datadog / Custom APM

```typescript
import { StatsD } from 'hot-shots';

const statsd = new StatsD();

setInterval(() => {
  const metrics = tenants.getMetrics();

  statsd.gauge('drizzle.pools.total', metrics.pools.total);

  for (const pool of metrics.pools.tenants) {
    statsd.gauge('drizzle.connections.idle', pool.connections.idle, { tenant: pool.tenantId });
    statsd.gauge('drizzle.connections.waiting', pool.connections.waiting, { tenant: pool.tenantId });
  }
}, 10000);
```

### Combined Health + Metrics Endpoint

```typescript
app.get('/status', async (req, res) => {
  const [health, metrics] = await Promise.all([
    tenants.healthCheck(),
    Promise.resolve(tenants.getMetrics()),
  ]);

  res.json({
    status: health.healthy ? 'healthy' : 'unhealthy',
    pools: {
      total: metrics.pools.total,
      max: metrics.pools.maxPools,
      unhealthy: health.unhealthyPools,
      degraded: health.degradedPools,
    },
    timestamp: metrics.timestamp,
  });
});
