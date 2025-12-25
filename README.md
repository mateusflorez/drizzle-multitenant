# drizzle-multitenant

[![npm version](https://img.shields.io/npm/v/drizzle-multitenant.svg)](https://www.npmjs.com/package/drizzle-multitenant)
[![GitHub](https://img.shields.io/github/stars/mateusflorez/drizzle-multitenant?style=social)](https://github.com/mateusflorez/drizzle-multitenant)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-tenancy toolkit for Drizzle ORM with schema isolation, tenant context, and parallel migrations.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║   drizzle-multitenant                                         ║  │
│  ║   ━━━━━━━━━━━━━━━━━━━━                                        ║  │
│  ║                                                               ║  │
│  ║   Schema isolation  •  Context propagation  •  Migrations     ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────────────────────┘
```

## Features

- **Schema Isolation** - Automatic PostgreSQL schema-per-tenant with LRU pool management
- **Context Propagation** - AsyncLocalStorage-based tenant context across your entire stack
- **Parallel Migrations** - Apply migrations to all tenants concurrently with progress tracking
- **Cross-Schema Queries** - Type-safe queries joining tenant and shared schemas
- **Framework Integrations** - Express, Fastify, NestJS, and Hono middleware/plugins
- **CLI Tools** - Generate migrations, manage tenants, check status

## Installation

```bash
npm install drizzle-multitenant drizzle-orm pg
```

## Quick Start

### 1. Define your configuration

```typescript
// tenant.config.ts
import { defineConfig } from 'drizzle-multitenant';
import * as tenantSchema from './schemas/tenant';
import * as sharedSchema from './schemas/shared';

export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
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
  // Optional: CLI migrations config
  migrations: {
    tenantFolder: './drizzle/tenant',
    migrationsTable: '__drizzle_migrations', // Custom table name
    tenantDiscovery: async () => {
      // Return list of tenant IDs for migrations
      return ['tenant-1', 'tenant-2'];
    },
  },
});
```

### 2. Create the tenant manager

```typescript
import { createTenantManager } from 'drizzle-multitenant';
import config from './tenant.config';

const tenants = createTenantManager(config);

// Get typed DB for a tenant
const db = tenants.getDb('tenant-123');
const users = await db.select().from(schema.users);

// Get shared DB (public schema)
const shared = tenants.getSharedDb();
const plans = await shared.select().from(sharedSchema.plans);
```

### 3. Use context propagation

```typescript
import { createTenantContext } from 'drizzle-multitenant';

const ctx = createTenantContext(tenants);

// Run code within tenant context
await ctx.runWithTenant({ tenantId: 'tenant-123' }, async () => {
  const db = ctx.getTenantDb();
  // All queries automatically scoped to tenant
  const users = await db.select().from(schema.users);
});
```

## Framework Integrations

### Express

```typescript
import { createExpressMiddleware } from 'drizzle-multitenant/express';

const middleware = createExpressMiddleware({
  manager: tenants,
  extractTenantId: (req) => req.headers['x-tenant-id'] as string,
  validateTenant: async (id) => checkTenantExists(id),
});

app.use('/api/:tenantId/*', middleware);
```

### Fastify

```typescript
import { fastifyTenantPlugin } from 'drizzle-multitenant/fastify';

await fastify.register(fastifyTenantPlugin, {
  manager: tenants,
  extractTenantId: (req) => req.headers['x-tenant-id'] as string,
});
```

### NestJS

```typescript
import { TenantModule, InjectTenantDb } from 'drizzle-multitenant/nestjs';

@Module({
  imports: [
    TenantModule.forRoot({
      config: tenantConfig,
      extractTenantId: (req) => req.headers['x-tenant-id'],
      isGlobal: true,
    }),
  ],
})
export class AppModule {}

@Injectable({ scope: Scope.REQUEST })
export class UserService {
  constructor(@InjectTenantDb() private readonly db: TenantDb) {}

  async findAll() {
    return this.db.select().from(users);
  }
}
```

#### Singleton Services (Cron Jobs, Event Handlers)

Use `TenantDbFactory` when you need to access tenant databases from singleton services:

```typescript
import { TenantDbFactory, InjectTenantDbFactory } from 'drizzle-multitenant/nestjs';

@Injectable() // Singleton - no scope needed
export class ReportService {
  constructor(@InjectTenantDbFactory() private dbFactory: TenantDbFactory) {}

  async generateReport(tenantId: string) {
    const db = this.dbFactory.getDb(tenantId);
    return db.select().from(reports);
  }
}

// Cron job example
@Injectable()
export class DailyReportCron {
  constructor(@InjectTenantDbFactory() private dbFactory: TenantDbFactory) {}

  @Cron('0 8 * * *')
  async run() {
    const tenants = await this.getTenantIds();
    for (const tenantId of tenants) {
      const db = this.dbFactory.getDb(tenantId);
      await this.processReports(db);
    }
  }
}
```

#### Debugging

The injected `TenantDb` provides debug utilities:

```typescript
// Console output shows useful info
console.log(tenantDb);
// [TenantDb] tenant=123 schema=empresa_123

// Access debug information
console.log(tenantDb.__debug);
// { tenantId: '123', schemaName: 'empresa_123', isProxy: true, poolCount: 5 }

// Quick access
console.log(tenantDb.__tenantId); // '123'

// In tests
expect(tenantDb.__tenantId).toBe('expected-tenant');
```

## CLI Commands

```bash
# Initialize configuration (interactive wizard)
npx drizzle-multitenant init

# Generate a new migration
npx drizzle-multitenant generate --name=add-users-table

# Apply migrations to all tenants (with progress bar)
npx drizzle-multitenant migrate --all --concurrency=10

# Interactive tenant selection
npx drizzle-multitenant migrate  # Shows checkbox to select tenants

# Mark migrations as applied without executing SQL
# Useful for syncing tracking with already-applied migrations
npx drizzle-multitenant migrate --all --mark-applied

# Check migration status
npx drizzle-multitenant status

# Sync: detect divergences between disk and database
npx drizzle-multitenant sync --status

# Mark missing migrations as applied
npx drizzle-multitenant sync --mark-missing

# Remove orphan records (migrations deleted from disk)
npx drizzle-multitenant sync --clean-orphans

# Create a new tenant schema
npx drizzle-multitenant tenant:create --id=new-tenant

# Drop a tenant schema
npx drizzle-multitenant tenant:drop --id=old-tenant --force

# Convert migration table format
npx drizzle-multitenant convert-format --to=name --dry-run

# Generate shell completions
npx drizzle-multitenant completion bash >> ~/.bashrc
npx drizzle-multitenant completion zsh >> ~/.zshrc
npx drizzle-multitenant completion fish >> ~/.config/fish/completions/drizzle-multitenant.fish
npx drizzle-multitenant completion powershell >> $PROFILE
```

### Global Options

```bash
--json       # Output as JSON (for scripts/CI)
--verbose    # Show detailed output
--quiet      # Only show errors
--no-color   # Disable colored output
```

### JSON Output

```bash
# Get status as JSON for scripting
npx drizzle-multitenant status --json | jq '.tenants[] | select(.pending > 0)'

# Parse migration results
npx drizzle-multitenant migrate --all --json | jq '.summary'
```

### Status Output

```
┌──────────────────┬──────────────┬────────────┬─────────┬─────────┬──────────┐
│ Tenant           │ Schema       │ Format     │ Applied │ Pending │ Status   │
├──────────────────┼──────────────┼────────────┼─────────┼─────────┼──────────┤
│ abc-123          │ tenant_abc   │ drizzle-kit│ 45      │ 3       │ Behind   │
│ def-456          │ tenant_def   │ name       │ 48      │ 0       │ OK       │
│ ghi-789          │ tenant_ghi   │ (new)      │ 0       │ 48      │ Behind   │
└──────────────────┴──────────────┴────────────┴─────────┴─────────┴──────────┘
```

### Sync Migrations

The `sync` command detects and fixes divergences between migrations on disk and the tracking table in the database.

**Use cases:**

| Scenario | Solution |
|----------|----------|
| Migration file renamed | `--clean-orphans` removes old record |
| Migration file deleted | `--clean-orphans` removes orphan record |
| Migrations applied manually | `--mark-missing` syncs tracking |
| Legacy project onboarding | `migrate --mark-applied` marks all as applied |

```bash
# Show sync status for all tenants
npx drizzle-multitenant sync --status

# Show as JSON
npx drizzle-multitenant sync --status --json

# Mark missing migrations as applied (in disk but not tracked)
npx drizzle-multitenant sync --mark-missing

# Remove orphan records (tracked but not in disk)
npx drizzle-multitenant sync --clean-orphans

# Fix all divergences at once
npx drizzle-multitenant sync --mark-missing --clean-orphans
```

### Shell Completions

Enable tab-completion for your shell:

```bash
# Bash
npx drizzle-multitenant completion bash >> ~/.bashrc
source ~/.bashrc

# Zsh
npx drizzle-multitenant completion zsh >> ~/.zshrc
source ~/.zshrc

# Fish
npx drizzle-multitenant completion fish > ~/.config/fish/completions/drizzle-multitenant.fish

# PowerShell
npx drizzle-multitenant completion powershell >> $PROFILE
```

After setup, press `Tab` to autocomplete commands and options:

```bash
npx drizzle-multitenant mi<Tab>  # completes to "migrate"
npx drizzle-multitenant migrate --<Tab>  # shows available options
```

## Migration Table Formats

`drizzle-multitenant` supports multiple migration table formats for compatibility with existing databases:

### Supported Formats

| Format | Identifier | Timestamp | Compatible With |
|--------|------------|-----------|-----------------|
| `name` | Filename | `applied_at` (timestamp) | drizzle-multitenant native |
| `hash` | SHA-256 | `created_at` (timestamp) | Custom scripts |
| `drizzle-kit` | SHA-256 | `created_at` (bigint) | drizzle-kit migrate |

### Configuration

```typescript
// tenant.config.ts
export default defineConfig({
  // ...
  migrations: {
    tenantFolder: './drizzle/tenant',
    tenantDiscovery: async () => getTenantIds(),

    /**
     * Table format for tracking migrations
     * - "auto": Auto-detect existing format (default)
     * - "name": Filename-based (drizzle-multitenant native)
     * - "hash": SHA-256 hash
     * - "drizzle-kit": Exact drizzle-kit format
     */
    tableFormat: 'auto',

    /**
     * Format to use when creating new tables (only for "auto" mode)
     * @default "name"
     */
    defaultFormat: 'name',
  },
});
```

### Migrating from drizzle-kit

If you have existing databases with migrations applied via `drizzle-kit migrate`, the CLI will automatically detect the format:

```bash
# Check current format for all tenants
npx drizzle-multitenant status

# Apply new migrations (works with any format)
npx drizzle-multitenant migrate --all
```

### Converting Between Formats

Use the `convert-format` command to standardize all tenants to a single format:

```bash
# Preview conversion (dry-run)
npx drizzle-multitenant convert-format --to=name --dry-run

# Convert all tenants to name format
npx drizzle-multitenant convert-format --to=name

# Convert specific tenant
npx drizzle-multitenant convert-format --to=name --tenant=abc-123

# Convert to drizzle-kit format (for compatibility)
npx drizzle-multitenant convert-format --to=drizzle-kit
```

## Cross-Schema Queries

```typescript
import { createCrossSchemaQuery } from 'drizzle-multitenant/cross-schema';

const query = createCrossSchemaQuery({
  tenantDb: tenants.getDb('tenant-123'),
  sharedDb: tenants.getSharedDb(),
  tenantSchema: 'tenant_123',
  sharedSchema: 'public',
});

// Type-safe join between tenant and shared tables
const result = await query
  .select({
    orderId: orders.id,
    planName: subscriptionPlans.name,
  })
  .from(orders)
  .leftJoin(subscriptionPlans, eq(orders.planId, subscriptionPlans.id));
```

## Pool Warmup

Pre-warm pools during application startup to eliminate cold start latency for your most active tenants:

```typescript
const tenants = createTenantManager(config);

// Warmup specific tenants
const result = await tenants.warmup(['tenant-1', 'tenant-2', 'tenant-3']);
console.log(`Warmed ${result.succeeded} pools in ${result.durationMs}ms`);

// Warmup with options
await tenants.warmup(tenantIds, {
  concurrency: 5,           // Parallel warmup (default: 10)
  ping: true,               // Execute SELECT 1 to verify connection (default: true)
  onProgress: (id, status) => console.log(`${id}: ${status}`),
});

// Warmup top tenants (e.g., by activity)
const topTenants = await getTopTenantsByActivity(20);
await tenants.warmup(topTenants);
```

### NestJS Integration

```typescript
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectTenantManager } from 'drizzle-multitenant/nestjs';
import type { TenantManager } from 'drizzle-multitenant';

@Injectable()
export class WarmupService implements OnApplicationBootstrap {
  constructor(@InjectTenantManager() private manager: TenantManager) {}

  async onApplicationBootstrap() {
    const topTenants = await this.getTopTenants();
    const result = await this.manager.warmup(topTenants);
    console.log(`Warmed ${result.succeeded} pools, ${result.alreadyWarm} already warm`);
  }

  private async getTopTenants(): Promise<string[]> {
    // Return your most active tenant IDs
    return ['tenant-1', 'tenant-2', 'tenant-3'];
  }
}
```

### Warmup Result

```typescript
interface WarmupResult {
  total: number;        // Total tenants processed
  succeeded: number;    // Successfully warmed
  failed: number;       // Failed to warm
  alreadyWarm: number;  // Already had active pool
  durationMs: number;   // Total duration
  details: TenantWarmupResult[];
}
```

## API Reference

### Core

| Export | Description |
|--------|-------------|
| `defineConfig()` | Create typed configuration |
| `createTenantManager()` | Create pool manager instance |
| `createTenantContext()` | Create AsyncLocalStorage context |

### Manager Methods

| Method | Description |
|--------|-------------|
| `getDb(tenantId)` | Get Drizzle instance for tenant |
| `getSharedDb()` | Get Drizzle instance for shared schema |
| `getSchemaName(tenantId)` | Get schema name for tenant |
| `hasPool(tenantId)` | Check if pool exists |
| `getPoolCount()` | Get count of active pools |
| `getActiveTenantIds()` | Get list of active tenant IDs |
| `evictPool(tenantId)` | Force evict a pool |
| `warmup(tenantIds, options?)` | Pre-warm pools to reduce cold start |
| `dispose()` | Cleanup all pools |

### NestJS Decorators

| Decorator | Description |
|-----------|-------------|
| `@InjectTenantDb()` | Inject tenant database (request-scoped) |
| `@InjectTenantDbFactory()` | Inject factory for singleton services |
| `@InjectSharedDb()` | Inject shared database |
| `@InjectTenantContext()` | Inject tenant context |
| `@InjectTenantManager()` | Inject tenant manager |
| `@RequiresTenant()` | Mark route as requiring tenant |
| `@PublicRoute()` | Mark route as public |

### TenantDbFactory Methods

| Method | Description |
|--------|-------------|
| `getDb(tenantId)` | Get Drizzle instance for tenant |
| `getSharedDb()` | Get shared database instance |
| `getSchemaName(tenantId)` | Get schema name for tenant |
| `getDebugInfo(tenantId)` | Get debug info (tenantId, schema, pool stats) |
| `getManager()` | Get underlying TenantManager |

## Requirements

- Node.js 18+
- PostgreSQL 12+
- Drizzle ORM 0.29+

## Tech Stack

| Package | Purpose |
|---------|---------|
| `drizzle-orm` | Type-safe ORM |
| `pg` | PostgreSQL driver |
| `lru-cache` | Pool management |
| `commander` | CLI framework |
| `chalk` | Terminal styling |
| `ora` | Loading spinners |
| `cli-table3` | Table formatting |
| `cli-progress` | Progress bars |
| `@inquirer/prompts` | Interactive prompts |

## Comparison

| Feature | drizzle-multitenant | Manual Implementation |
|---------|---------------------|----------------------|
| Pool management | Automatic LRU | Manual |
| Context propagation | AsyncLocalStorage | Pass through params |
| Parallel migrations | Built-in CLI | Custom scripts |
| Cross-schema queries | Type-safe builder | Raw SQL |
| Framework support | Express/Fastify/NestJS/Hono | DIY |

## License

MIT
