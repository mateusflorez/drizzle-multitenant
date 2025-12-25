# Getting Started

## Installation

```bash
npm install drizzle-multitenant drizzle-orm pg
```

## Requirements

- Node.js 18+
- PostgreSQL 12+
- Drizzle ORM 0.29+

## Basic Setup

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
  migrations: {
    tenantFolder: './drizzle/tenant',
    tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
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
  const users = await db.select().from(schema.users);
});
```

## Next Steps

- [Configuration](./configuration.md) - All configuration options
- [Framework Integrations](./framework-integrations.md) - Express, Fastify, NestJS
- [CLI Commands](./cli.md) - Migration management
