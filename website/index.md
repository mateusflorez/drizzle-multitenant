---
layout: home

hero:
  name: drizzle-multitenant
  text: Multi-tenancy for Drizzle ORM
  tagline: Schema isolation, tenant context, and parallel migrations for PostgreSQL
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/mateusflorez/drizzle-multitenant

features:
  - icon: 🔐
    title: Schema Isolation
    details: PostgreSQL schema-per-tenant with automatic LRU pool management. Each tenant gets complete data isolation.
  - icon: 🔄
    title: Context Propagation
    details: AsyncLocalStorage-based tenant context that flows through your entire request lifecycle.
  - icon: ⚡
    title: Parallel Migrations
    details: Apply migrations to all tenants concurrently with progress tracking and error handling.
  - icon: 🔗
    title: Cross-Schema Queries
    details: Type-safe queries joining tenant and shared tables with automatic schema detection.
  - icon: 🔁
    title: Connection Retry
    details: Automatic retry with exponential backoff for resilient database connections.
  - icon: 🛠️
    title: Framework Support
    details: First-class support for Express, Fastify, and NestJS with middleware and plugins.
---

## Quick Start

```bash
npm install drizzle-multitenant drizzle-orm pg
```

```typescript
// tenant.config.ts
import { defineConfig } from 'drizzle-multitenant';
import * as schema from './schema';

export default defineConfig({
  connection: { url: process.env.DATABASE_URL! },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (id) => `tenant_${id}`,
  },
  schemas: { tenant: schema },
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
```

<div style="margin-top: 2rem; text-align: center;">
  <a href="/drizzle-multitenant/guide/getting-started" style="display: inline-block; padding: 0.75rem 1.5rem; background: var(--vp-c-brand-1); color: white; border-radius: 8px; text-decoration: none; font-weight: 500;">Read the Documentation →</a>
</div>
