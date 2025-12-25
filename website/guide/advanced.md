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

### Built-in Prometheus Export

drizzle-multitenant provides a `MetricsCollector` and `PrometheusExporter` for easy Prometheus integration:

```typescript
import { MetricsCollector, PrometheusExporter } from 'drizzle-multitenant/metrics';

const collector = new MetricsCollector(manager);
const exporter = new PrometheusExporter(collector);

// Get Prometheus-formatted metrics
const prometheusMetrics = await exporter.export();
console.log(prometheusMetrics);
```

Output:

```
# HELP drizzle_multitenant_pool_active_total Active pools
# TYPE drizzle_multitenant_pool_active_total gauge
drizzle_multitenant_pool_active_total 5

# HELP drizzle_multitenant_pool_max_total Maximum pools
# TYPE drizzle_multitenant_pool_max_total gauge
drizzle_multitenant_pool_max_total 50

# HELP drizzle_multitenant_pool_connections_total Pool connections
# TYPE drizzle_multitenant_pool_connections_total gauge
drizzle_multitenant_pool_connections_total{tenant="abc",state="total"} 10
drizzle_multitenant_pool_connections_total{tenant="abc",state="idle"} 7
drizzle_multitenant_pool_connections_total{tenant="abc",state="waiting"} 0

# HELP drizzle_multitenant_health_status Health status (1=healthy, 0=unhealthy)
# TYPE drizzle_multitenant_health_status gauge
drizzle_multitenant_health_status 1
```

### Express Integration

```typescript
import express from 'express';
import { createMetricsMiddleware } from 'drizzle-multitenant/metrics';

const app = express();

// Add metrics endpoint
app.use(createMetricsMiddleware(manager, {
  path: '/metrics',
  includeRuntime: true,
  auth: {
    username: process.env.METRICS_USER,
    password: process.env.METRICS_PASS,
  },
}));

// Your routes...
app.get('/', (req, res) => res.send('Hello'));

app.listen(3000);
```

Options:
- `path` - Endpoint path (default: `/metrics`)
- `includeRuntime` - Include Node.js runtime metrics
- `auth` - Basic auth credentials for protecting the endpoint

### Fastify Integration

```typescript
import Fastify from 'fastify';
import { metricsPlugin } from 'drizzle-multitenant/metrics';

const fastify = Fastify();

// Register metrics plugin
await fastify.register(metricsPlugin, {
  manager,
  path: '/metrics',
  includeRuntime: true,
});

// Access metrics collector via decorator
fastify.get('/custom-metrics', async (request, reply) => {
  const metrics = await fastify.metricsCollector.collect();
  return metrics;
});

await fastify.listen({ port: 3000 });
```

### CLI Metrics Command

View metrics from the command line:

```bash
# Console output
npx drizzle-multitenant metrics

# Prometheus format
npx drizzle-multitenant metrics --prometheus

# Watch mode
npx drizzle-multitenant metrics --watch --interval=5000

# Include health check
npx drizzle-multitenant metrics --health
```

### Manual Prometheus Integration

If you prefer manual control:

```typescript
import { Gauge, Registry } from 'prom-client';

const register = new Registry();

const poolGauge = new Gauge({
  name: 'drizzle_pool_count',
  help: 'Active pools',
  registers: [register],
});

const connectionsGauge = new Gauge({
  name: 'drizzle_connections',
  help: 'Connections by tenant',
  labelNames: ['tenant', 'state'],
  registers: [register],
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

### Available Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `drizzle_multitenant_pool_active_total` | gauge | Number of active pools |
| `drizzle_multitenant_pool_max_total` | gauge | Maximum configured pools |
| `drizzle_multitenant_pool_connections_total` | gauge | Connections by tenant/state |
| `drizzle_multitenant_shared_initialized` | gauge | Shared pool status |
| `drizzle_multitenant_shared_connections` | gauge | Shared pool connections |
| `drizzle_multitenant_health_status` | gauge | Overall health (1=ok) |
| `drizzle_multitenant_health_pools_total` | gauge | Total pools checked |
| `drizzle_multitenant_health_pools_degraded` | gauge | Degraded pools count |
| `drizzle_multitenant_health_pools_unhealthy` | gauge | Unhealthy pools count |
| `drizzle_multitenant_health_response_time_ms` | gauge | Health check duration |

## Doctor Command

Diagnose configuration and connection issues with the doctor command:

```bash
npx drizzle-multitenant doctor
```

Output:

```
🔍 Checking drizzle-multitenant configuration...

✓ Configuration file found: tenant.config.ts
✓ Database connection: OK (PostgreSQL 15.4, latency: 12ms)
✓ Tenant discovery: Found 42 tenants
✓ Migrations folder: ./drizzle/tenant-migrations (12 files)
✓ Shared migrations folder: ./drizzle/shared-migrations (3 files)
✓ Schema isolation: schema-based
✓ Pool configuration: max=50, ttl=3600000ms

⚠ Recommendations:
  1. Consider increasing maxPools (current: 50, tenants: 42)
  2. Enable metrics collection for production monitoring

📊 Health Summary:
  Pools: 5 active, 0 degraded, 0 unhealthy
  Shared DB: OK (12ms latency)
```

### What Doctor Checks

| Check | Description |
|-------|-------------|
| Configuration file | Validates tenant.config.ts exists and is valid |
| Database connection | Tests PostgreSQL connectivity, version, latency |
| Tenant discovery | Counts tenants returned by discovery function |
| Migrations folder | Validates folder exists and counts migration files |
| Shared migrations | Checks shared migrations folder if configured |
| Schema isolation | Validates isolation strategy configuration |
| Pool configuration | Checks maxPools and poolTtlMs settings |

### JSON Output

```bash
npx drizzle-multitenant doctor --json
```

```json
{
  "success": true,
  "checks": [
    { "name": "configuration", "status": "ok", "message": "tenant.config.ts" },
    { "name": "database", "status": "ok", "message": "PostgreSQL 15.4", "latencyMs": 12 },
    { "name": "tenants", "status": "ok", "message": "42 tenants found" },
    { "name": "migrations", "status": "ok", "message": "12 files" },
    { "name": "sharedMigrations", "status": "ok", "message": "3 files" },
    { "name": "isolation", "status": "ok", "message": "schema-based" },
    { "name": "poolConfig", "status": "warn", "message": "maxPools close to tenant count" }
  ],
  "recommendations": [
    "Consider increasing maxPools (current: 50, tenants: 42)",
    "Enable metrics collection for production monitoring"
  ],
  "health": {
    "healthy": true,
    "totalPools": 5,
    "degradedPools": 0,
    "unhealthyPools": 0,
    "sharedDbLatencyMs": 12
  }
}
```

### Use in CI/CD

```yaml
# .github/workflows/health.yml
- name: Check database configuration
  run: |
    npx drizzle-multitenant doctor --json > doctor-report.json
    if ! jq -e '.success' doctor-report.json; then
      echo "Doctor check failed"
      exit 1
    fi
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
