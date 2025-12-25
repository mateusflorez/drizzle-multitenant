# API Contracts Documentation

> **Purpose**: This document defines the public API contracts that MUST be preserved during refactoring.
> **Created**: 2025-12-25
> **Related**: REFACTOR_PROPOSAL.md

## Overview

This document serves as the authoritative reference for the public APIs of the god components targeted for refactoring. Any changes to these APIs constitute a breaking change and require a major version bump.

---

## Migrator Class

### Factory Function

```typescript
function createMigrator<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>
>(
  config: Config<TTenantSchema, TSharedSchema>,
  migratorConfig: MigratorConfig
): Migrator<TTenantSchema, TSharedSchema>;
```

### Constructor

```typescript
class Migrator<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>
> {
  constructor(
    tenantConfig: Config<TTenantSchema, TSharedSchema>,
    migratorConfig: MigratorConfig
  );
}
```

### Migration Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `migrateAll` | `(options?: MigrateOptions) => Promise<MigrationResults>` | Migrate all discovered tenants in parallel |
| `migrateTenant` | `(tenantId: string, migrations?: MigrationFile[], options?: { dryRun?: boolean }) => Promise<TenantMigrationResult>` | Migrate a single tenant |
| `migrateTenants` | `(tenantIds: string[], options?: MigrateOptions) => Promise<MigrationResults>` | Migrate specific tenants |
| `markAsApplied` | `(tenantId: string, options?: { onProgress?: MigrateOptions['onProgress'] }) => Promise<TenantMigrationResult>` | Mark migrations as applied without executing SQL |
| `markAllAsApplied` | `(options?: MigrateOptions) => Promise<MigrationResults>` | Mark all tenants' migrations as applied |

### Status Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `getStatus` | `() => Promise<TenantMigrationStatus[]>` | Get migration status for all tenants |
| `getTenantStatus` | `(tenantId: string, migrations?: MigrationFile[]) => Promise<TenantMigrationStatus>` | Get migration status for a specific tenant |

### Tenant Lifecycle

| Method | Signature | Description |
|--------|-----------|-------------|
| `createTenant` | `(tenantId: string, options?: CreateTenantOptions) => Promise<void>` | Create a new tenant schema |
| `dropTenant` | `(tenantId: string, options?: DropTenantOptions) => Promise<void>` | Drop a tenant schema |
| `tenantExists` | `(tenantId: string) => Promise<boolean>` | Check if tenant schema exists |

### Sync Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `getSyncStatus` | `() => Promise<SyncStatus>` | Get sync status for all tenants |
| `getTenantSyncStatus` | `(tenantId: string, migrations?: MigrationFile[]) => Promise<TenantSyncStatus>` | Get sync status for a tenant |
| `markMissing` | `(tenantId: string) => Promise<TenantSyncResult>` | Mark missing migrations as applied for a tenant |
| `markAllMissing` | `(options?: SyncOptions) => Promise<SyncResults>` | Mark missing migrations as applied for all tenants |
| `cleanOrphans` | `(tenantId: string) => Promise<TenantSyncResult>` | Remove orphan migration records for a tenant |
| `cleanAllOrphans` | `(options?: SyncOptions) => Promise<SyncResults>` | Remove orphan records for all tenants |

### Drift Detection

| Method | Signature | Description |
|--------|-----------|-------------|
| `getSchemaDrift` | `(options?: SchemaDriftOptions) => Promise<SchemaDriftStatus>` | Detect schema drift across tenants |
| `getTenantSchemaDrift` | `(tenantId: string, referenceTenantId: string) => Promise<TenantSchemaDrift>` | Compare tenant against reference |
| `introspectTenantSchema` | `(tenantId: string, options?: { excludeTables?: string[] }) => Promise<TenantSchema \| null>` | Introspect tenant schema |

### Seeding

| Method | Signature | Description |
|--------|-----------|-------------|
| `seedTenant` | `(tenantId: string, seedFn: SeedFunction<TTenantSchema>) => Promise<TenantSeedResult>` | Seed a single tenant |
| `seedAll` | `(seedFn: SeedFunction<TTenantSchema>, options?: SeedOptions) => Promise<SeedResults>` | Seed all tenants |
| `seedTenants` | `(tenantIds: string[], seedFn: SeedFunction<TTenantSchema>, options?: SeedOptions) => Promise<SeedResults>` | Seed specific tenants |

---

## PoolManager Class

### Constructor

```typescript
class PoolManager<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>
> {
  constructor(config: Config<TTenantSchema, TSharedSchema>);
}
```

### Pool Access

| Method | Signature | Description |
|--------|-----------|-------------|
| `getDb` | `(tenantId: string) => TenantDb<TTenantSchema>` | Get or create tenant database (sync) |
| `getDbAsync` | `(tenantId: string) => Promise<TenantDb<TTenantSchema>>` | Get or create tenant database with validation |
| `getSharedDb` | `() => SharedDb<TSharedSchema>` | Get or create shared database (sync) |
| `getSharedDbAsync` | `() => Promise<SharedDb<TSharedSchema>>` | Get or create shared database with validation |

### Pool Information

| Method | Signature | Description |
|--------|-----------|-------------|
| `getSchemaName` | `(tenantId: string) => string` | Get schema name for tenant |
| `hasPool` | `(tenantId: string) => boolean` | Check if pool exists for tenant |
| `getPoolCount` | `() => number` | Get count of active pools |
| `getActiveTenantIds` | `() => string[]` | Get list of active tenant IDs |

### Pool Management

| Method | Signature | Description |
|--------|-----------|-------------|
| `evictPool` | `(tenantId: string) => Promise<void>` | Force evict a tenant pool |
| `warmup` | `(tenantIds: string[], options?: WarmupOptions) => Promise<WarmupResult>` | Pre-warm pools |
| `dispose` | `() => Promise<void>` | Dispose all pools |

### Cleanup

| Method | Signature | Description |
|--------|-----------|-------------|
| `startCleanup` | `() => void` | Start TTL cleanup interval |
| `stopCleanup` | `() => void` | Stop TTL cleanup interval |

### Health & Metrics

| Method | Signature | Description |
|--------|-----------|-------------|
| `healthCheck` | `(options?: HealthCheckOptions) => Promise<HealthCheckResult>` | Check health of pools |
| `getMetrics` | `() => MetricsResult` | Get pool metrics |

---

## Type Contracts

### MigratorConfig

```typescript
interface MigratorConfig {
  migrationsFolder: string;
  migrationsTable?: string;
  tenantDiscovery: () => Promise<string[]>;
  hooks?: MigrationHooks;
  tableFormat?: 'auto' | 'name' | 'hash' | 'drizzle-kit';
  defaultFormat?: 'name' | 'hash' | 'drizzle-kit';
}
```

### MigrateOptions

```typescript
interface MigrateOptions {
  concurrency?: number;
  onProgress?: MigrationProgressCallback;
  onError?: MigrationErrorHandler;
  dryRun?: boolean;
}
```

### MigrationResults

```typescript
interface MigrationResults {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: TenantMigrationResult[];
}
```

### TenantMigrationResult

```typescript
interface TenantMigrationResult {
  tenantId: string;
  schemaName: string;
  success: boolean;
  appliedMigrations: string[];
  error?: string;
  durationMs: number;
  format?: TableFormat;
}
```

### TenantMigrationStatus

```typescript
interface TenantMigrationStatus {
  tenantId: string;
  schemaName: string;
  appliedCount: number;
  pendingCount: number;
  pendingMigrations: string[];
  status: 'ok' | 'behind' | 'error';
  error?: string;
  format: TableFormat | null;
}
```

### HealthCheckResult

```typescript
interface HealthCheckResult {
  healthy: boolean;
  pools: PoolHealth[];
  sharedDb?: 'ok' | 'degraded' | 'unhealthy';
  sharedDbResponseTimeMs?: number;
  totalPools: number;
  degradedPools: number;
  unhealthyPools: number;
  timestamp: string;
  durationMs: number;
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
    connections: { total: number; idle: number; waiting: number } | null;
  };
  timestamp: string;
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

---

## Behavioral Contracts

### Pool Caching

1. **Same tenant returns same instance**: `getDb('tenant-1') === getDb('tenant-1')`
2. **LRU eviction**: When `maxPools` is reached, oldest accessed pool is evicted
3. **Access updates LRU order**: Accessing a pool moves it to most recently used

### Migration Ordering

1. **Migrations sorted by timestamp**: Files are loaded and applied in timestamp order
2. **Filename format**: Expects `<timestamp>_<name>.sql` format
3. **Hash computation**: SHA-256 hash of file content for drizzle-kit compatibility

### Concurrency

1. **Batch processing**: Tenants are processed in batches of `concurrency` size
2. **Parallel within batch**: All tenants in a batch run concurrently
3. **Sequential between batches**: Next batch starts only after current completes

### Error Handling

1. **Continue mode**: `onError: () => 'continue'` - continues with next tenant
2. **Abort mode**: `onError: () => 'abort'` - stops processing, marks remaining as skipped
3. **Error result**: Failed tenants have `success: false` and `error` message

### Hook Ordering

```
beforeTenant(tenantId)
  ├── beforeMigration(tenantId, migrationName)
  │   └── [apply migration]
  └── afterMigration(tenantId, migrationName, durationMs)
afterTenant(tenantId, result)
```

### Disposal

1. **Idempotent**: Multiple calls to `dispose()` are safe
2. **Throws after dispose**: Operations throw `[drizzle-multitenant] PoolManager has been disposed` error
3. **Cleans all resources**: All pools are closed, cleanup intervals stopped

---

## Invariants

### Must Always Be True

1. `results.total === results.succeeded + results.failed + results.skipped`
2. `getPoolCount() <= config.isolation.maxPools`
3. `getActiveTenantIds().length === getPoolCount()`
4. After `dispose()`: `getPoolCount() === 0`
5. `healthCheck().totalPools === getPoolCount()`

### Must Never Happen

1. Two pools for the same tenant ID
2. Pool creation without calling `onPoolCreated` hook
3. Migration applied twice to same tenant
4. `getDb()` returning different instance for same tenant (within same pool lifecycle)

---

## Migration Path

When refactoring, ensure:

1. All methods listed above remain accessible
2. All return types match exactly
3. All behavioral contracts are preserved
4. All invariants hold true

Use the characterization tests to verify compliance:
- `src/migrator/migrator.characterization.test.ts`
- `src/pool.characterization.test.ts`
