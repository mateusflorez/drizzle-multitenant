---
layout: home

hero:
  name: drizzle-multitenant
  text: Multi-tenancy for Drizzle ORM
  tagline: Schema isolation, tenant context propagation, and parallel migrations for PostgreSQL. Build SaaS applications with confidence.
  image:
    src: /logo.svg
    alt: drizzle-multitenant
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/mateusflorez/drizzle-multitenant

features:
  - icon: 🏢
    title: Schema Isolation
    details: PostgreSQL schema-per-tenant with automatic LRU pool management. Complete data isolation with zero cross-tenant access.
    link: /guide/configuration
    linkText: Configure isolation
  - icon: 🔄
    title: Context Propagation
    details: AsyncLocalStorage-based tenant context flows through your entire request lifecycle. No parameter drilling required.
    link: /guide/getting-started#use-context-propagation
    linkText: Learn more
  - icon: ⚡
    title: Parallel Migrations
    details: Apply migrations to hundreds of tenants concurrently. Progress tracking, error handling, and automatic retries.
    link: /guide/cli
    linkText: CLI commands
  - icon: 🔗
    title: Cross-Schema Queries
    details: Type-safe queries joining tenant and shared tables. Automatic schema detection with full Drizzle ORM support.
    link: /guide/cross-schema
    linkText: Query builder
  - icon: 💚
    title: Health Checks & Metrics
    details: Monitor pool health for load balancers. Export metrics to Prometheus, Datadog, or any observability platform.
    link: /guide/advanced#health-checks
    linkText: Observability
  - icon: 🛠️
    title: Interactive CLI
    details: Menu-driven interface for tenant management, migrations, seeding, schema drift detection, and cloning.
    link: /guide/cli#interactive-menu
    linkText: CLI commands
---

<style>
.quick-start {
  max-width: 800px;
  margin: 0 auto;
  padding: 48px 24px;
}

.quick-start h2 {
  text-align: center;
  font-size: 1.8rem;
  font-weight: 700;
  margin-bottom: 8px;
  background: linear-gradient(135deg, #6AADAB 0%, #4A9A98 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.quick-start .subtitle {
  text-align: center;
  color: var(--vp-c-text-2);
  margin-bottom: 32px;
}

.code-blocks {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cta-section {
  text-align: center;
  padding: 48px 24px;
  margin-top: 24px;
}

.cta-button {
  display: inline-block;
  padding: 14px 36px;
  background: linear-gradient(135deg, #6AADAB 0%, #4A9A98 100%);
  color: #1a1a1a !important;
  border-radius: 8px;
  text-decoration: none !important;
  font-weight: 700;
  font-size: 1.05rem;
  transition: all 0.25s ease;
  border: none;
}

.cta-button:hover {
  background: linear-gradient(135deg, #7BBDBB 0%, #6AADAB 100%);
  color: #1a1a1a !important;
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(106, 173, 171, 0.4);
}

.stats {
  display: flex;
  justify-content: center;
  gap: 48px;
  padding: 32px 24px;
  flex-wrap: wrap;
}

.stat {
  text-align: center;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: #6AADAB;
}

.stat-label {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
</style>

<div class="quick-start">
  <h2>Quick Start</h2>
  <p class="subtitle">Get up and running in under 5 minutes</p>

  <div class="code-blocks">

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

// Type-safe database for each tenant
const db = tenants.getDb('acme');
const users = await db.select().from(schema.users);
```

  </div>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-value">0</div>
    <div class="stat-label">Lines of boilerplate</div>
  </div>
  <div class="stat">
    <div class="stat-value">10x</div>
    <div class="stat-label">Faster migrations</div>
  </div>
  <div class="stat">
    <div class="stat-value">100%</div>
    <div class="stat-label">Data isolation</div>
  </div>
</div>

<div class="cta-section">
  <a href="/drizzle-multitenant/guide/getting-started" class="cta-button">
    Read the Documentation →
  </a>
</div>
