# Performance

Optimize drizzle-multitenant for production workloads.

## Pool Sizing

### Understanding Pool Limits

drizzle-multitenant manages two levels of pooling:

```
┌─────────────────────────────────────────────┐
│           LRU Pool Manager                  │
│  maxPools: 50 (tenant pools)                │
│                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ tenant_1│ │ tenant_2│ │ tenant_N│  ...  │
│  │ max: 10 │ │ max: 10 │ │ max: 10 │       │
│  └─────────┘ └─────────┘ └─────────┘       │
└─────────────────────────────────────────────┘

Total possible connections = maxPools x poolConfig.max
Default: 50 x 10 = 500 connections
```

### Configuration Guidelines

| Tenants | maxPools | poolConfig.max | Total | Use Case |
|---------|----------|----------------|-------|----------|
| < 50 | 50 | 10 | 500 | Small app, all tenants fit |
| 50-200 | 100 | 5 | 500 | Medium app, active subset |
| 200-1000 | 200 | 3 | 600 | Large app, LRU eviction |
| > 1000 | 500 | 2 | 1000 | Enterprise, aggressive eviction |

### Calculate Your Limits

```typescript
// 1. Check PostgreSQL max connections
// SHOW max_connections; -> 100 (default)

// 2. Reserve for other apps and admin
const reserved = 20;
const available = 100 - reserved; // 80

// 3. Calculate pool settings
const expectedConcurrentTenants = 40;
const connectionsPerPool = Math.floor(available / expectedConcurrentTenants);
// 80 / 40 = 2 connections per pool

export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    poolConfig: {
      max: connectionsPerPool, // 2
      idleTimeoutMillis: 30000,
    },
  },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (id) => `tenant_${id}`,
    maxPools: expectedConcurrentTenants * 2, // 80 (buffer for LRU)
    poolTtlMs: 30 * 60 * 1000, // 30 minutes
  },
});
```

## Pool Warmup

### Why Warmup?

First request to a tenant incurs connection overhead:

| Operation | Cold Start | Warmed |
|-----------|------------|--------|
| Pool creation | ~50ms | 0ms |
| Connection | ~20ms | 0ms |
| Query | ~10ms | ~10ms |
| **Total** | **~80ms** | **~10ms** |

### Warmup Strategies

**1. Startup Warmup (Recommended)**

```typescript
// app.ts
const tenants = createTenantManager(config);

async function bootstrap() {
  // Get most active tenants
  const topTenants = await getTopTenantsByUsage(100);

  const result = await tenants.warmup(topTenants, {
    concurrency: 20,
    ping: true,
    onProgress: (id, status) => {
      if (status === 'failed') console.error(`Warmup failed: ${id}`);
    },
  });

  console.log(`Warmed ${result.succeeded}/${result.total} pools in ${result.durationMs}ms`);
}

bootstrap();
```

**2. NestJS OnModuleInit**

```typescript
@Injectable()
export class WarmupService implements OnModuleInit {
  constructor(
    @InjectTenantManager() private manager: TenantManager,
    private tenantService: TenantService,
  ) {}

  async onModuleInit() {
    const tenants = await this.tenantService.getActiveTenants();
    await this.manager.warmup(tenants, { concurrency: 10 });
  }
}
```

**3. Scheduled Warmup**

```typescript
import { Cron } from '@nestjs/schedule';

@Injectable()
export class ScheduledWarmupService {
  @Cron('0 */5 * * * *') // Every 5 minutes
  async warmupNewTenants() {
    const recent = await this.getRecentlyActiveTenants();
    const cold = recent.filter(id => !this.manager.hasPool(id));

    if (cold.length > 0) {
      await this.manager.warmup(cold, { concurrency: 5 });
    }
  }
}
```

## Connection Retry

### Retry for Resilience

Transient errors are common in production:

```typescript
export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    retry: {
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      jitter: true, // Prevent thundering herd
    },
  },
});
```

### Retry Timeline

```
Attempt 1: Immediate
Attempt 2: ~100ms (+jitter)
Attempt 3: ~200ms (+jitter)
Attempt 4: ~400ms (+jitter)
Attempt 5: ~800ms (+jitter)
Total max wait: ~1600ms
```

### Use Async Methods

```typescript
// With retry (recommended for production)
const db = await tenants.getDbAsync('tenant-123');

// Without retry (backward compatible)
const db = tenants.getDb('tenant-123');
```

## Debug Mode for Profiling

### Enable Query Logging

```typescript
export default defineConfig({
  debug: {
    enabled: process.env.NODE_ENV !== 'production',
    logQueries: true,
    logPoolEvents: true,
    slowQueryThreshold: 100, // ms
  },
});
```

### Output Analysis

```
[drizzle-multitenant] tenant=abc POOL_CREATED schema=tenant_abc
[drizzle-multitenant] tenant=abc query="SELECT..." duration=45ms
[drizzle-multitenant] tenant=abc SLOW_QUERY duration=250ms query="SELECT * FROM orders..."
```

### Custom Logger for Metrics

```typescript
import { Counter, Histogram } from 'prom-client';

const queryDuration = new Histogram({
  name: 'drizzle_query_duration_ms',
  help: 'Query duration in milliseconds',
  labelNames: ['tenant', 'type'],
});

const slowQueries = new Counter({
  name: 'drizzle_slow_queries_total',
  help: 'Total slow queries',
  labelNames: ['tenant'],
});

export default defineConfig({
  debug: {
    enabled: true,
    slowQueryThreshold: 100,
    logger: (message, context) => {
      if (context?.durationMs) {
        queryDuration
          .labels(context.tenantId || 'shared', context.type || 'unknown')
          .observe(context.durationMs);
      }

      if (context?.type === 'slow_query') {
        slowQueries.labels(context.tenantId || 'shared').inc();
      }
    },
  },
});
```

## Monitoring

### Key Metrics to Track

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| Pool count | Active tenant pools | > 80% of maxPools |
| Connection count | Total DB connections | > 80% of max_connections |
| Query duration | Average query time | > 100ms p95 |
| Slow queries | Queries over threshold | > 10/minute |
| Pool evictions | LRU evictions | > 50/minute |
| Retry attempts | Connection retries | > 5/minute |

### Pool Health Check

```typescript
app.get('/health/pools', (req, res) => {
  const manager = tenants;
  const poolCount = manager.getPoolCount();
  const activeTenants = manager.getActiveTenantIds();

  res.json({
    status: poolCount < 45 ? 'healthy' : 'warning',
    pools: {
      active: poolCount,
      max: 50,
      utilization: `${(poolCount / 50 * 100).toFixed(1)}%`,
    },
    tenants: activeTenants.length,
    retryConfig: manager.getRetryConfig(),
  });
});
```

### Prometheus Metrics Endpoint

```typescript
import { collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics();

// Custom pool metrics
const poolGauge = new Gauge({
  name: 'tenant_pools_active',
  help: 'Number of active tenant pools',
});

setInterval(() => {
  poolGauge.set(tenants.getPoolCount());
}, 5000);

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});
```

## Query Optimization

### Avoid N+1 Queries

```typescript
// Bad - N+1
const orders = await db.select().from(ordersTable);
for (const order of orders) {
  const items = await db.select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, order.id));
}

// Good - Single query with join
const ordersWithItems = await db.select()
  .from(ordersTable)
  .leftJoin(orderItemsTable, eq(ordersTable.id, orderItemsTable.orderId));
```

### Use Prepared Statements

Drizzle ORM uses parameterized queries by default:

```typescript
// Safe and optimized
const user = await db.select()
  .from(users)
  .where(eq(users.id, tenantId)); // Parameterized
```

### Index Strategy

```sql
-- Per-tenant indexes are automatically scoped
CREATE INDEX idx_orders_user_id ON tenant_abc.orders(user_id);

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE schemaname LIKE 'tenant_%'
ORDER BY idx_scan DESC;
```

## Performance Checklist

### Configuration
- [ ] Set appropriate maxPools for tenant count
- [ ] Tune poolConfig.max based on PostgreSQL limits
- [ ] Enable retry for transient errors
- [ ] Set reasonable poolTtlMs for your workload

### Warmup
- [ ] Warmup top tenants on startup
- [ ] Consider scheduled warmup for new tenants
- [ ] Monitor warmup success rate

### Monitoring
- [ ] Enable debug mode in non-production
- [ ] Track pool utilization
- [ ] Alert on slow queries
- [ ] Monitor connection retries

### Queries
- [ ] Avoid N+1 queries
- [ ] Use appropriate indexes
- [ ] Profile slow queries regularly
- [ ] Consider connection pooling at load balancer
