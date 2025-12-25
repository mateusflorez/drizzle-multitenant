# API Reference

## Core Exports

```typescript
import {
  defineConfig,
  createTenantManager,
  createTenantContext,
  withShared,
  createCrossSchemaQuery,
  createMigrator,
  withRetry,
  createRetrier,
  isRetryableError,
} from 'drizzle-multitenant';
```

## TenantManager

```typescript
const tenants = createTenantManager(config);
```

| Method | Description |
|--------|-------------|
| `getDb(tenantId)` | Get Drizzle instance for tenant (sync) |
| `getDbAsync(tenantId)` | Get Drizzle instance with retry & validation |
| `getSharedDb()` | Get shared database instance (sync) |
| `getSharedDbAsync()` | Get shared instance with retry & validation |
| `getSchemaName(tenantId)` | Get schema name for tenant |
| `hasPool(tenantId)` | Check if pool exists |
| `getPoolCount()` | Get count of active pools |
| `getActiveTenantIds()` | Get list of active tenant IDs |
| `getRetryConfig()` | Get current retry configuration |
| `evictPool(tenantId)` | Force evict a pool |
| `warmup(tenantIds, options?)` | Pre-warm pools |
| `dispose()` | Cleanup all pools |

## TenantContext

```typescript
const ctx = createTenantContext(tenants);
```

| Method | Description |
|--------|-------------|
| `runWithTenant(data, callback)` | Execute callback within tenant context |
| `getTenantId()` | Get current tenant ID (throws if outside context) |
| `getTenantIdOrNull()` | Get current tenant ID or null |
| `getTenantDb()` | Get Drizzle instance for current tenant |
| `getSharedDb()` | Get shared database instance |
| `isInTenantContext()` | Check if inside tenant context |

## Types

### Config

```typescript
interface Config<TTenantSchema, TSharedSchema> {
  connection: ConnectionConfig;
  isolation: IsolationConfig;
  schemas: SchemasConfig<TTenantSchema, TSharedSchema>;
  hooks?: Hooks;
  debug?: DebugConfig;
  migrations?: MigrationsConfig;
}
```

### ConnectionConfig

```typescript
interface ConnectionConfig {
  url: string;
  poolConfig?: PoolConfig;
  retry?: RetryConfig;
}
```

### RetryConfig

```typescript
interface RetryConfig {
  maxAttempts?: number;      // default: 3
  initialDelayMs?: number;   // default: 100
  maxDelayMs?: number;       // default: 5000
  backoffMultiplier?: number; // default: 2
  jitter?: boolean;          // default: true
  isRetryable?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}
```

### IsolationConfig

```typescript
interface IsolationConfig {
  strategy: 'schema';
  schemaNameTemplate: (tenantId: string) => string;
  maxPools?: number;    // default: 50
  poolTtlMs?: number;   // default: 3600000 (1 hour)
}
```

### Hooks

```typescript
interface Hooks {
  onPoolCreated?: (tenantId: string) => void | Promise<void>;
  onPoolEvicted?: (tenantId: string) => void | Promise<void>;
  onError?: (tenantId: string, error: Error) => void | Promise<void>;
}
```

### DebugConfig

```typescript
interface DebugConfig {
  enabled: boolean;
  logQueries?: boolean;
  logPoolEvents?: boolean;
  slowQueryThreshold?: number;
  logger?: (message: string, context?: DebugContext) => void;
}
```

### WarmupOptions

```typescript
interface WarmupOptions {
  concurrency?: number;  // default: 10
  ping?: boolean;        // default: true
  onProgress?: (tenantId: string, status: 'starting' | 'completed' | 'failed') => void;
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

## NestJS Decorators

```typescript
import {
  InjectTenantDb,
  InjectTenantDbFactory,
  InjectSharedDb,
  InjectTenantContext,
  InjectTenantManager,
  RequiresTenant,
  PublicRoute,
} from 'drizzle-multitenant/nestjs';
```

## TenantDbFactory

```typescript
interface TenantDbFactory {
  getDb(tenantId: string): TenantDb;
  getSharedDb(): SharedDb;
  getSchemaName(tenantId: string): string;
  getDebugInfo(tenantId: string): DebugInfo;
  getManager(): TenantManager;
}
```
