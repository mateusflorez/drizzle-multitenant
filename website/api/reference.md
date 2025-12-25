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
| `getActiveTenantIds()` | Get array of tenant IDs with active pools |
| `getRetryConfig()` | Get current retry configuration object |
| `evictPool(tenantId)` | Force evict a pool |
| `warmup(tenantIds, options?)` | Pre-warm pools for specified tenants |
| `healthCheck(options?)` | Check health of all pools |
| `getMetrics()` | Get pool metrics for monitoring |
| `dispose()` | Cleanup all pools and connections |

### Method Details

#### getActiveTenantIds()

Returns an array of tenant IDs that currently have active pools:

```typescript
const activeIds = tenants.getActiveTenantIds();
// ['tenant-1', 'tenant-2', 'tenant-3']

// Use for monitoring
console.log(`Active pools: ${activeIds.length}/${tenants.getPoolCount()}`);
```

#### getRetryConfig()

Returns the current retry configuration:

```typescript
const retryConfig = tenants.getRetryConfig();
// {
//   maxAttempts: 3,
//   initialDelayMs: 100,
//   maxDelayMs: 5000,
//   backoffMultiplier: 2,
//   jitter: true
// }
```

#### healthCheck(options?)

Check the health of all pools:

```typescript
const health = await tenants.healthCheck();
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

// With options
const health = await tenants.healthCheck({
  tenantIds: ['tenant-1', 'tenant-2'],
  ping: true,
  pingTimeoutMs: 3000,
  includeShared: true,
});

// Load balancer endpoint
app.get('/health', async (req, res) => {
  const health = await tenants.healthCheck();
  res.status(health.healthy ? 200 : 503).json(health);
});
```

#### getMetrics()

Get pool metrics for monitoring:

```typescript
const metrics = tenants.getMetrics();
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

### HealthCheckOptions

```typescript
interface HealthCheckOptions {
  tenantIds?: string[];    // Check specific tenants only
  ping?: boolean;          // Actually ping the database (default: true)
  pingTimeoutMs?: number;  // Timeout for ping (default: 5000)
  includeShared?: boolean; // Include shared database (default: true)
}
```

### HealthCheckResult

```typescript
interface HealthCheckResult {
  healthy: boolean;
  pools: PoolHealthStatus[];
  sharedDb?: { status: 'ok' | 'degraded' | 'unhealthy'; responseTimeMs?: number };
  totalPools: number;
  degradedPools: number;
  unhealthyPools: number;
  timestamp: string;
  durationMs: number;
}

interface PoolHealthStatus {
  tenantId: string;
  status: 'ok' | 'degraded' | 'unhealthy';
  totalConnections: number;
  idleConnections: number;
  waitingRequests?: number;
  error?: string;
}
```

### Metrics

```typescript
interface Metrics {
  pools: {
    total: number;
    maxPools: number;
    tenants: TenantPoolMetrics[];
  };
  shared?: {
    connections: ConnectionMetrics;
  };
  timestamp: string;
}

interface TenantPoolMetrics {
  tenantId: string;
  schemaName: string;
  connections: ConnectionMetrics;
}

interface ConnectionMetrics {
  total: number;
  idle: number;
  waiting: number;
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

### HealthCheckOptions

```typescript
interface HealthCheckOptions {
  ping?: boolean;           // Execute SELECT 1 (default: true)
  pingTimeoutMs?: number;   // Timeout for ping (default: 5000)
  includeShared?: boolean;  // Check shared database (default: true)
  tenantIds?: string[];     // Check specific tenants only
}
```

### HealthCheckResult

```typescript
interface HealthCheckResult {
  healthy: boolean;
  pools: PoolHealth[];
  sharedDb: PoolHealthStatus;
  sharedDbResponseTimeMs?: number;
  sharedDbError?: string;
  totalPools: number;
  degradedPools: number;
  unhealthyPools: number;
  timestamp: string;
  durationMs: number;
}

type PoolHealthStatus = 'ok' | 'degraded' | 'unhealthy';

interface PoolHealth {
  tenantId: string;
  schemaName: string;
  status: PoolHealthStatus;
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
  responseTimeMs?: number;
  error?: string;
}
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

## Metrics Module

```typescript
import {
  MetricsCollector,
  PrometheusExporter,
  createMetricsMiddleware, // Express
  metricsPlugin,           // Fastify
} from 'drizzle-multitenant/metrics';
```

### MetricsCollector

```typescript
const collector = new MetricsCollector(manager);

// Collect all metrics
const metrics = await collector.collect();
// {
//   pools: { active: 5, max: 50, tenants: [...] },
//   shared: { initialized: true, connections: {...} },
//   health: { healthy: true, ... },
//   runtime: { uptime: 3600, memory: {...} },
//   timestamp: '2024-01-15T10:30:00Z'
// }

// Collect with options
const metrics = await collector.collect({
  includeHealth: true,
  includeRuntime: true,
});
```

### PrometheusExporter

```typescript
const exporter = new PrometheusExporter(collector);

// Export as Prometheus text format
const text = await exporter.export();
// # HELP drizzle_multitenant_pool_active_total Active pools
// # TYPE drizzle_multitenant_pool_active_total gauge
// drizzle_multitenant_pool_active_total 5
// ...
```

### Express Middleware

```typescript
import { createMetricsMiddleware } from 'drizzle-multitenant/metrics';

app.use(createMetricsMiddleware(manager, {
  path: '/metrics',
  includeRuntime: true,
  auth: { username: 'admin', password: 'secret' },
}));
```

### Fastify Plugin

```typescript
import { metricsPlugin } from 'drizzle-multitenant/metrics';

await fastify.register(metricsPlugin, {
  manager,
  path: '/metrics',
});

// Decorators available
fastify.metricsCollector  // MetricsCollector
fastify.metricsExporter   // PrometheusExporter
```

## Linting Module

```typescript
import { SchemaLinter, LintRule } from 'drizzle-multitenant/lint';
```

### SchemaLinter

```typescript
const linter = new SchemaLinter({
  rules: {
    'table-naming': ['error', { style: 'snake_case' }],
    'require-primary-key': 'error',
    'prefer-uuid-pk': 'warn',
  },
});

const results = await linter.lint({
  tenantSchemaPath: './src/db/schema/tenant',
  sharedSchemaPath: './src/db/schema/shared',
});

// {
//   success: false,
//   totalSchemas: 12,
//   errors: 1,
//   warnings: 2,
//   issues: [...]
// }
```

### LintResult

```typescript
interface LintResult {
  success: boolean;
  totalSchemas: number;
  errors: number;
  warnings: number;
  issues: LintIssue[];
}

interface LintIssue {
  file: string;
  line: number;
  column: number;
  rule: string;
  severity: 'error' | 'warn';
  message: string;
}
```

### Available Rules

| Rule | Description |
|------|-------------|
| `table-naming` | Table naming convention |
| `column-naming` | Column naming convention |
| `require-primary-key` | Require primary key |
| `prefer-uuid-pk` | Prefer UUID over serial |
| `require-timestamps` | Require created_at/updated_at |
| `index-foreign-keys` | Index on foreign keys |
| `no-cascade-delete` | Avoid CASCADE DELETE |
| `require-soft-delete` | Require deleted_at column |

## Scaffold Module

```typescript
import {
  generateSchemaTemplate,
  generateSeedTemplate,
  generateMigrationTemplate,
} from 'drizzle-multitenant/scaffold';
```

### generateSchemaTemplate

```typescript
const result = generateSchemaTemplate('orders', {
  type: 'tenant',
  timestamps: true,
  softDelete: false,
  uuid: true,
  withZod: true,
  withExample: false,
});

// result.content - Generated TypeScript code
// result.path - Suggested file path
```

### generateSeedTemplate

```typescript
const result = generateSeedTemplate('initial', {
  type: 'tenant',
  table: 'users',
});

// result.content - Generated seed file
// result.path - Suggested file path
```

### generateMigrationTemplate

```typescript
const result = generateMigrationTemplate('create-orders', {
  type: 'tenant',
  template: 'create-table', // or 'add-column', 'add-index', 'blank'
  sequence: 1,
});

// result.content - Generated SQL migration
// result.path - Suggested file path
```

## Export Module

```typescript
import {
  SchemaExporter,
  JsonSchemaExporter,
  TypeScriptExporter,
  MermaidExporter,
  SchemaImporter,
} from 'drizzle-multitenant/export';
```

### JsonSchemaExporter

```typescript
const exporter = new JsonSchemaExporter();
const schema = exporter.export({
  tenant: tenantSchema,
  shared: sharedSchema,
});

// JSON Schema format with definitions for each table
```

### TypeScriptExporter

```typescript
const exporter = new TypeScriptExporter({
  includeZod: true,
});

const types = exporter.export({
  tenant: tenantSchema,
  shared: sharedSchema,
});

// TypeScript interfaces and Zod schemas
```

### MermaidExporter

```typescript
const exporter = new MermaidExporter({
  theme: 'dark', // 'default', 'dark', 'forest', 'neutral'
  showIndexes: true,
});

const erd = exporter.export({
  tenant: tenantSchema,
  shared: sharedSchema,
});

// Mermaid ERD diagram
```

### SchemaImporter

```typescript
const importer = new SchemaImporter({
  includeZod: true,
});

// Parse JSON and generate files
const files = importer.import(jsonSchema);

// Or write to directory
await importer.importToDirectory(jsonSchema, './src/db/schema', {
  overwrite: false,
  dryRun: false,
});
```

## Migrator Shared Schema

Additional methods for shared schema management:

```typescript
const migrator = createMigrator(config, {
  migrationsFolder: './drizzle/tenant-migrations',
  sharedMigrationsFolder: './drizzle/shared-migrations',
});
```

| Method | Description |
|--------|-------------|
| `migrateShared()` | Apply shared schema migrations |
| `getSharedStatus()` | Get shared migration status |
| `migrateAllWithShared(options)` | Migrate shared then all tenants |
| `seedShared(seedFn)` | Seed the shared schema |
| `seedAllWithShared(sharedFn, tenantFn, options)` | Seed shared then all tenants |
| `hasSharedSeeding()` | Check if shared seeding is configured |

### SharedSeedFunction

```typescript
type SharedSeedFunction = (db: SharedDatabase) => Promise<void>;

// Example
const sharedSeed: SharedSeedFunction = async (db) => {
  await db.insert(plans).values([...]).onConflictDoNothing();
};
