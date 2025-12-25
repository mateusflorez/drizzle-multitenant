<p align="center">
  <img src="./assets/banner.svg" alt="drizzle-multitenant" width="500" />
</p>

<p align="center">
  <strong>Multi-tenancy toolkit for Drizzle ORM</strong>
</p>

<p align="center">
  Schema isolation, tenant context propagation, and parallel migrations for PostgreSQL
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/drizzle-multitenant"><img src="https://img.shields.io/npm/v/drizzle-multitenant.svg?style=flat-square&color=4A9A98" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/drizzle-multitenant"><img src="https://img.shields.io/npm/dm/drizzle-multitenant.svg?style=flat-square&color=3D5A80" alt="npm downloads"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-6AADAB.svg?style=flat-square" alt="License"></a>
  <a href="https://mateusflorez.github.io/drizzle-multitenant/"><img src="https://img.shields.io/badge/docs-online-2B3E5C.svg?style=flat-square" alt="Documentation"></a>
</p>

<br />

## Features

| Feature | Description |
|---------|-------------|
| **Schema Isolation** | PostgreSQL schema-per-tenant with automatic LRU pool management |
| **Shared Schema** | Full support for shared schema migrations and seeding (plans, roles, permissions) |
| **Parallel Migrations** | Apply migrations to all tenants concurrently with progress tracking |
| **Cross-Schema Queries** | Type-safe joins between tenant and shared tables |
| **Schema Linting** | Validate schemas with 8 configurable rules (naming, conventions, security) |
| **Scaffolding** | Generate schemas, seeds, and migrations from templates |
| **Export/Import** | Export to JSON Schema, TypeScript types, or Mermaid ERD diagrams |
| **Observability** | Built-in Prometheus exporter with Express/Fastify integrations |
| **Framework Support** | First-class Express, Fastify, and NestJS integrations |

<br />

## Installation

```bash
npm install drizzle-multitenant drizzle-orm pg
```

<br />

## Quick Start

### 1. Define your configuration

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

### 2. Create the tenant manager

```typescript
// app.ts
import { createTenantManager } from 'drizzle-multitenant';
import config from './tenant.config';

const tenants = createTenantManager(config);

// Type-safe database for each tenant
const db = tenants.getDb('acme');
const users = await db.select().from(schema.users);
```

<br />

## CLI Commands

```bash
# Setup & Migrations
npx drizzle-multitenant init --template=full     # Enhanced setup wizard
npx drizzle-multitenant generate --name=users    # Generate tenant migration
npx drizzle-multitenant generate:shared --name=plans  # Generate shared migration
npx drizzle-multitenant migrate --all            # Apply to all tenants
npx drizzle-multitenant migrate:shared           # Apply shared migrations

# Developer Tools
npx drizzle-multitenant scaffold:schema orders   # Generate schema file
npx drizzle-multitenant lint                     # Validate schemas
npx drizzle-multitenant doctor                   # Diagnose configuration
npx drizzle-multitenant export --format=mermaid  # Export ERD diagram

# Tenant Management
npx drizzle-multitenant status                   # Check migration status
npx drizzle-multitenant tenant:create --id=acme  # Create new tenant
npx drizzle-multitenant seed:all                 # Seed shared + tenants
```

<br />

## Framework Integrations

<details>
<summary><strong>Express</strong></summary>

```typescript
import { createExpressMiddleware } from 'drizzle-multitenant/express';

app.use(createExpressMiddleware({
  manager: tenants,
  extractTenantId: (req) => req.headers['x-tenant-id'] as string,
}));

app.get('/users', async (req, res) => {
  const db = req.tenantContext.db;
  const users = await db.select().from(schema.users);
  res.json(users);
});
```

</details>

<details>
<summary><strong>Fastify</strong></summary>

```typescript
import { fastifyTenantPlugin } from 'drizzle-multitenant/fastify';

fastify.register(fastifyTenantPlugin, {
  manager: tenants,
  extractTenantId: (req) => req.headers['x-tenant-id'] as string,
});

fastify.get('/users', async (req, reply) => {
  const db = req.tenantContext.db;
  const users = await db.select().from(schema.users);
  return users;
});
```

</details>

<details>
<summary><strong>NestJS</strong></summary>

```typescript
import { TenantModule, InjectTenantDb } from 'drizzle-multitenant/nestjs';

@Module({
  imports: [
    TenantModule.forRoot({
      config,
      extractTenantId: (req) => req.headers['x-tenant-id'],
    }),
  ],
})
export class AppModule {}

@Injectable({ scope: Scope.REQUEST })
export class UserService {
  constructor(@InjectTenantDb() private db: TenantDb) {}

  findAll() {
    return this.db.select().from(users);
  }
}
```

</details>

<br />

## Documentation

<table>
  <tr>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/getting-started">Getting Started</a></td>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/configuration">Configuration</a></td>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/cli">CLI Commands</a></td>
  </tr>
  <tr>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/shared-schema">Shared Schema</a></td>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/scaffold">Scaffolding</a></td>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/schema-linting">Schema Linting</a></td>
  </tr>
  <tr>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/export-import">Export & Import</a></td>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/cross-schema">Cross-Schema Queries</a></td>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/advanced">Advanced Features</a></td>
  </tr>
  <tr>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/frameworks/express">Express</a></td>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/frameworks/fastify">Fastify</a></td>
    <td><a href="https://mateusflorez.github.io/drizzle-multitenant/guide/frameworks/nestjs">NestJS</a></td>
  </tr>
</table>

<br />

## Requirements

- Node.js 18+
- PostgreSQL 12+
- Drizzle ORM 0.29+

<br />

## License

MIT
