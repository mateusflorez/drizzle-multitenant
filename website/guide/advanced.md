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

Monitor pool health for load balancers and observability:

```typescript
const manager = createTenantManager(config);

// Check health of all pools
const health = await manager.healthCheck();
// {
//   healthy: true,
//   pools: [
//     { tenantId: 'abc', status: 'ok', totalConnections: 5, idleConnections: 3 },
//     { tenantId: 'def', status: 'degraded', totalConnections: 5, waitingRequests: 2 },
//   ],
//   sharedDb: { status: 'ok', responseTimeMs: 12 },
//   totalPools: 2,
//   degradedPools: 0,
//   unhealthyPools: 0,
//   timestamp: '2024-01-15T10:30:00Z',
//   durationMs: 45
// }
```

### Load Balancer Endpoint

```typescript
app.get('/health', async (req, res) => {
  const health = await manager.healthCheck();
  res.status(health.healthy ? 200 : 503).json(health);
});
```

### Health Check Options

```typescript
const health = await manager.healthCheck({
  tenantIds: ['tenant-1', 'tenant-2'], // Check specific tenants
  ping: true,                           // Actually ping the database
  pingTimeoutMs: 3000,                  // Timeout for ping
  includeShared: true,                  // Include shared database
});
```

### Pool Statuses

| Status | Description |
|--------|-------------|
| `ok` | Pool healthy, connections available |
| `degraded` | Pool has waiting requests or high usage |
| `unhealthy` | Pool unresponsive or erroring |

## Metrics

Get pool metrics for monitoring (Prometheus, Datadog, etc.):

```typescript
const metrics = manager.getMetrics();
// {
//   pools: {
//     total: 15,
//     maxPools: 50,
//     tenants: [
//       { tenantId: 'abc', schemaName: 'tenant_abc', connections: { total: 10, idle: 7, waiting: 0 } },
//       { tenantId: 'def', schemaName: 'tenant_def', connections: { total: 10, idle: 3, waiting: 2 } },
//     ],
//   },
//   shared: { connections: { total: 10, idle: 8, waiting: 0 } },
//   timestamp: '2024-01-15T10:30:00Z',
// }
```

### Prometheus Integration

```typescript
import { Gauge } from 'prom-client';

const poolGauge = new Gauge({ name: 'drizzle_pool_count', help: 'Active pools' });
const connectionsGauge = new Gauge({
  name: 'drizzle_connections',
  help: 'Connections by tenant',
  labelNames: ['tenant', 'state']
});

app.get('/metrics', async (req, res) => {
  const metrics = manager.getMetrics();

  poolGauge.set(metrics.pools.total);
  for (const pool of metrics.pools.tenants) {
    connectionsGauge.labels(pool.tenantId, 'idle').set(pool.connections.idle);
    connectionsGauge.labels(pool.tenantId, 'active').set(pool.connections.total - pool.connections.idle);
  }

  res.set('Content-Type', 'text/plain');
  res.send(await register.metrics());
});
```

## Lifecycle Hooks

Hook into pool lifecycle events:

```typescript
export default defineConfig({
  // ...
  hooks: {
    onPoolCreated: (tenantId) => {
      logger.info({ tenant: tenantId }, 'Pool created');
    },
    onPoolEvicted: (tenantId) => {
      logger.info({ tenant: tenantId }, 'Pool evicted');
    },
    onError: (tenantId, error) => {
      logger.error({ tenant: tenantId, error: error.message }, 'Pool error');
      // Send to error tracking
      Sentry.captureException(error, { tags: { tenantId } });
    },
  },
});
```

## Programmatic Seeding

Seed tenants from code:

```typescript
import { createMigrator } from 'drizzle-multitenant/migrator';

const migrator = createMigrator(config, migratorConfig);

// Seed single tenant
await migrator.seedTenant('tenant-1', async (db, tenantId) => {
  await db.insert(roles).values([
    { name: 'admin', permissions: ['*'] },
    { name: 'user', permissions: ['read'] },
  ]);
});

// Seed all tenants
await migrator.seedAll(seedFunction, { concurrency: 10 });

// Seed specific tenants
await migrator.seedTenants(['tenant-1', 'tenant-2'], seedFunction);
```

## Schema Drift Detection

Detect schema differences between tenants programmatically:

```typescript
const migrator = createMigrator(config, migratorConfig);

// Detect drift in all tenants
const drift = await migrator.getSchemaDrift();
// {
//   referenceTenant: 'tenant-1',
//   total: 5,
//   noDrift: 4,
//   withDrift: 1,
//   error: 0,
//   details: [...],
//   timestamp: '2024-01-15T10:30:00Z',
//   durationMs: 245
// }

// Compare specific tenant against reference
const tenantDrift = await migrator.getTenantSchemaDrift('tenant-2', 'tenant-1');

// Introspect schema of a tenant
const schema = await migrator.introspectTenantSchema('tenant-1');
```

## Tenant Cloning

Clone tenants programmatically:

```typescript
const migrator = createMigrator(config, migratorConfig);

// Clone schema only
await migrator.cloneTenant('production', 'staging');

// Clone with data
await migrator.cloneTenant('production', 'dev', {
  includeData: true,
});

// Clone with data anonymization
await migrator.cloneTenant('production', 'dev', {
  includeData: true,
  anonymize: {
    enabled: true,
    rules: {
      users: {
        email: null,
        phone: null,
      },
    },
  },
});
```
