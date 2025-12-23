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

@Injectable()
export class UserService {
  constructor(@InjectTenantDb() private readonly db: TenantDb) {}

  async findAll() {
    return this.db.select().from(users);
  }
}
```

## CLI Commands

```bash
# Generate a new migration
npx drizzle-multitenant generate --name=add-users-table

# Apply migrations to all tenants
npx drizzle-multitenant migrate --all --concurrency=10

# Check migration status
npx drizzle-multitenant status

# Create a new tenant schema
npx drizzle-multitenant tenant:create --id=new-tenant

# Drop a tenant schema
npx drizzle-multitenant tenant:drop --id=old-tenant --force
```

### Status Output

```
┌─────────────────────┬─────────┬─────────┬──────────┐
│ Tenant              │ Applied │ Pending │ Status   │
├─────────────────────┼─────────┼─────────┼──────────┤
│ tenant_abc123       │ 15      │ 0       │ OK       │
│ tenant_def456       │ 15      │ 0       │ OK       │
│ tenant_ghi789       │ 14      │ 1       │ Behind   │
└─────────────────────┴─────────┴─────────┴──────────┘
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
| `evictPool(tenantId)` | Force evict a pool |
| `dispose()` | Cleanup all pools |

### NestJS Decorators

| Decorator | Description |
|-----------|-------------|
| `@InjectTenantDb()` | Inject tenant database |
| `@InjectSharedDb()` | Inject shared database |
| `@InjectTenantContext()` | Inject tenant context |
| `@InjectTenantManager()` | Inject tenant manager |
| `@RequiresTenant()` | Mark route as requiring tenant |
| `@PublicRoute()` | Mark route as public |

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
