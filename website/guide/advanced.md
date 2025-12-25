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
