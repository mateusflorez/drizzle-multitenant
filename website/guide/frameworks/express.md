# Express

Integration with Express.js using middleware.

## Basic Setup

```typescript
import express from 'express';
import { createTenantManager, createExpressMiddleware, createTenantContext } from 'drizzle-multitenant';
import config from './tenant.config';

const app = express();
const tenants = createTenantManager(config);
const tenantContext = createTenantContext();

// Apply tenant middleware
app.use(
  createExpressMiddleware({
    manager: tenants,
    context: tenantContext,
    extractTenantId: (req) => req.headers['x-tenant-id'] as string,
    onTenantResolved: (tenantId) => {
      console.log(`Tenant: ${tenantId}`);
    },
  })
);
```

## Using in Routes

```typescript
app.get('/users', async (req, res) => {
  const db = req.tenantContext!.db;
  const users = await db.select().from(schema.users);
  res.json(users);
});

app.post('/users', async (req, res) => {
  const db = req.tenantContext!.db;
  const { email, name } = req.body;

  const [user] = await db
    .insert(schema.users)
    .values({ email, name })
    .returning();

  res.status(201).json(user);
});
```

## Middleware Options

```typescript
createExpressMiddleware({
  manager: tenants,
  context: tenantContext,
  extractTenantId: (req) => req.headers['x-tenant-id'] as string,
  validateTenant: async (id) => checkTenantExists(id),
  onTenantResolved: (tenantId, req) => { /* ... */ },
  onError: (error, req, res, next) => { /* ... */ },
});
```

| Option | Type | Description |
|--------|------|-------------|
| `manager` | `TenantManager` | Required. The tenant manager instance |
| `context` | `TenantContext` | Optional. Context for propagation |
| `extractTenantId` | `(req) => string` | Required. Extract tenant ID from request |
| `validateTenant` | `(id) => Promise<boolean>` | Optional. Validate tenant exists |
| `onTenantResolved` | `(tenantId, req) => void` | Optional. Called when tenant is resolved |
| `onError` | `(error, req, res, next) => void` | Optional. Error handler |

## Async Methods with Retry

```typescript
app.get('/users', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'] as string;

  // getDbAsync includes automatic retry with exponential backoff
  const db = await tenants.getDbAsync(tenantId);
  const users = await db.select().from(schema.users);

  res.json(users);
});
```

## Full Example

See the [Express example](/examples/express) for a complete working project.
