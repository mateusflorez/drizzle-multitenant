# Express Example

A simple multi-tenant REST API using Express.js.

## Features

- Tenant isolation via PostgreSQL schemas
- Express middleware for automatic tenant context
- CRUD operations for users
- Connection retry with exponential backoff
- Pool management with LRU eviction

## Project Structure

```
express-basic/
├── src/
│   ├── index.ts      # Express app with routes
│   ├── config.ts     # drizzle-multitenant config
│   └── schema.ts     # Drizzle schema
├── drizzle/          # Generated migrations
├── package.json
└── tsconfig.json
```

## Configuration

```typescript
// config.ts
import { defineConfig } from 'drizzle-multitenant';
import * as schema from './schema';

export const config = defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
    },
  },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (tenantId) => `tenant_${tenantId}`,
    maxPools: 50,
  },
  schemas: { tenant: schema },
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    logQueries: true,
  },
});
```

## Middleware Setup

```typescript
import { createTenantManager, createExpressMiddleware, createTenantContext } from 'drizzle-multitenant';

const tenants = createTenantManager(config);
const tenantContext = createTenantContext();

app.use(
  createExpressMiddleware({
    manager: tenants,
    context: tenantContext,
    extractTenantId: (req) => req.headers['x-tenant-id'] as string,
  })
);
```

## Routes

```typescript
// List users
app.get('/users', async (req, res) => {
  const db = req.tenantContext!.db;
  const users = await db.select().from(schema.users);
  res.json(users);
});

// Create user
app.post('/users', async (req, res) => {
  const db = req.tenantContext!.db;
  const [user] = await db.insert(schema.users).values(req.body).returning();
  res.status(201).json(user);
});

// With async retry
app.get('/users-async', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  const db = await tenants.getDbAsync(tenantId);
  const users = await db.select().from(schema.users);
  res.json(users);
});
```

## API Endpoints

```bash
# Create user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"email": "john@acme.com", "name": "John Doe"}'

# List users
curl http://localhost:3000/users -H "X-Tenant-ID: acme"

# Get user by ID
curl http://localhost:3000/users/{id} -H "X-Tenant-ID: acme"

# Update user
curl -X PUT http://localhost:3000/users/{id} \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"name": "John Updated"}'

# Delete user
curl -X DELETE http://localhost:3000/users/{id} -H "X-Tenant-ID: acme"

# Health check
curl http://localhost:3000/health
```

## Source Code

[View on GitHub](https://github.com/mateusflorez/drizzle-multitenant/tree/main/examples/express-basic)
