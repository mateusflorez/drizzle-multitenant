# drizzle-multitenant

[![npm version](https://img.shields.io/npm/v/drizzle-multitenant.svg)](https://www.npmjs.com/package/drizzle-multitenant)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Documentation](https://img.shields.io/badge/docs-online-blue.svg)](https://mateusflorez.github.io/drizzle-multitenant/)

Multi-tenancy toolkit for Drizzle ORM with schema isolation, tenant context, and parallel migrations.

## Features

- **Schema Isolation** - PostgreSQL schema-per-tenant with LRU pool management
- **Context Propagation** - AsyncLocalStorage-based tenant context
- **Parallel Migrations** - Concurrent migrations with progress tracking
- **Cross-Schema Queries** - Type-safe joins between tenant and shared tables
- **Connection Retry** - Automatic retry with exponential backoff
- **Framework Support** - Express, Fastify, NestJS middleware/plugins
- **CLI Tools** - Generate, migrate, status, tenant management

## Installation

```bash
npm install drizzle-multitenant drizzle-orm pg
```

## Quick Start

```typescript
// tenant.config.ts
import { defineConfig } from 'drizzle-multitenant';
import * as tenantSchema from './schemas/tenant';

export default defineConfig({
  connection: { url: process.env.DATABASE_URL! },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (id) => `tenant_${id}`,
  },
  schemas: { tenant: tenantSchema },
});
```

```typescript
// app.ts
import { createTenantManager } from 'drizzle-multitenant';
import config from './tenant.config';

const tenants = createTenantManager(config);

// Get typed DB for a tenant
const db = tenants.getDb('tenant-123');
const users = await db.select().from(schema.users);

// With retry and validation
const db = await tenants.getDbAsync('tenant-123');
```

## CLI

```bash
npx drizzle-multitenant init                    # Setup wizard
npx drizzle-multitenant generate --name=users   # Create migration
npx drizzle-multitenant migrate --all           # Apply to all tenants
npx drizzle-multitenant status                  # Check status
```

## Framework Integrations

```typescript
// Express
import { createExpressMiddleware } from 'drizzle-multitenant/express';
app.use(createExpressMiddleware({ manager: tenants, extractTenantId: (req) => req.headers['x-tenant-id'] }));

// Fastify
import { fastifyTenantPlugin } from 'drizzle-multitenant/fastify';
fastify.register(fastifyTenantPlugin, { manager: tenants, extractTenantId: (req) => req.headers['x-tenant-id'] });

// NestJS
import { TenantModule, InjectTenantDb } from 'drizzle-multitenant/nestjs';
@Module({ imports: [TenantModule.forRoot({ config, extractTenantId: (req) => req.headers['x-tenant-id'] })] })
```

## Documentation

**[Read the full documentation →](https://mateusflorez.github.io/drizzle-multitenant/)**

- [Getting Started](https://mateusflorez.github.io/drizzle-multitenant/guide/getting-started)
- [Configuration](https://mateusflorez.github.io/drizzle-multitenant/guide/configuration)
- [Framework Integrations](https://mateusflorez.github.io/drizzle-multitenant/guide/frameworks/express)
- [CLI Commands](https://mateusflorez.github.io/drizzle-multitenant/guide/cli)
- [Cross-Schema Queries](https://mateusflorez.github.io/drizzle-multitenant/guide/cross-schema)
- [Advanced Features](https://mateusflorez.github.io/drizzle-multitenant/guide/advanced)
- [API Reference](https://mateusflorez.github.io/drizzle-multitenant/api/reference)
- [Examples](https://mateusflorez.github.io/drizzle-multitenant/examples/)

## Requirements

- Node.js 18+
- PostgreSQL 12+
- Drizzle ORM 0.29+

## License

MIT
