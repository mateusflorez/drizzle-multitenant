# Configuration

Complete reference for all configuration options.

## Basic Configuration

```typescript
import { defineConfig } from 'drizzle-multitenant';

export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    poolConfig: {
      max: 10,
      idleTimeoutMillis: 30000,
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
    },
  },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (tenantId) => `tenant_${tenantId}`,
    maxPools: 50,
    poolTtlMs: 60 * 60 * 1000,
  },
  schemas: {
    tenant: tenantSchema,
    shared: sharedSchema,
  },
  hooks: {
    onPoolCreated: (tenantId) => console.log(`Pool created: ${tenantId}`),
    onPoolEvicted: (tenantId) => console.log(`Pool evicted: ${tenantId}`),
    onError: (tenantId, error) => console.error(`Error: ${tenantId}`, error),
  },
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    logQueries: true,
    logPoolEvents: true,
    slowQueryThreshold: 1000,
  },
  migrations: {
    tenantFolder: './drizzle/tenant',
    migrationsTable: '__drizzle_migrations',
    tableFormat: 'auto',
    tenantDiscovery: async () => getTenantIds(),
  },
});
```

## Connection Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | Required | PostgreSQL connection URL |
| `poolConfig.max` | `number` | `10` | Maximum connections per pool |
| `poolConfig.idleTimeoutMillis` | `number` | `30000` | Idle connection timeout |
| `retry.maxAttempts` | `number` | `3` | Maximum retry attempts |
| `retry.initialDelayMs` | `number` | `100` | Initial delay before first retry |
| `retry.maxDelayMs` | `number` | `5000` | Maximum delay between retries |
| `retry.backoffMultiplier` | `number` | `2` | Exponential backoff multiplier |
| `retry.jitter` | `boolean` | `true` | Add randomness to prevent thundering herd |

## Isolation Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strategy` | `'schema'` | Required | Isolation strategy (only schema supported) |
| `schemaNameTemplate` | `function` | Required | Function to generate schema names |
| `maxPools` | `number` | `50` | Maximum concurrent pools (LRU eviction) |
| `poolTtlMs` | `number` | `3600000` | Pool TTL before cleanup (1 hour) |

## Debug Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable debug mode |
| `logQueries` | `boolean` | `true` | Log SQL queries |
| `logPoolEvents` | `boolean` | `true` | Log pool lifecycle events |
| `slowQueryThreshold` | `number` | `1000` | Slow query threshold in ms |
| `logger` | `function` | `console.log` | Custom logger function |

### Custom Logger Example

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

## Migration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tenantFolder` | `string` | Required | Path to tenant migrations |
| `migrationsTable` | `string` | `__drizzle_migrations` | Tracking table name |
| `tableFormat` | `'auto' \| 'name' \| 'hash' \| 'drizzle-kit'` | `'auto'` | Migration table format |
| `tenantDiscovery` | `function` | Required | Function to discover tenant IDs |
