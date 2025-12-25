# Fastify

Integration with Fastify using a plugin.

## Basic Setup

```typescript
import Fastify from 'fastify';
import { createTenantManager, createFastifyPlugin } from 'drizzle-multitenant';
import config from './tenant.config';

const fastify = Fastify({ logger: true });
const tenants = createTenantManager(config);

// Register tenant plugin
fastify.register(createFastifyPlugin, {
  manager: tenants,
  extractTenantId: (request) => request.headers['x-tenant-id'] as string,
  onTenantResolved: (tenantId, request) => {
    request.log.info({ tenantId }, 'Tenant resolved');
  },
});
```

## Using in Routes

```typescript
fastify.get('/users', async (request) => {
  const db = request.tenantDb!;
  return db.select().from(schema.users);
});

fastify.post<{ Body: { email: string; name: string } }>('/users', async (request, reply) => {
  const db = request.tenantDb!;
  const { email, name } = request.body;

  const [user] = await db
    .insert(schema.users)
    .values({ email, name })
    .returning();

  return reply.status(201).send(user);
});
```

## Plugin Options

```typescript
fastify.register(createFastifyPlugin, {
  manager: tenants,
  extractTenantId: (request) => request.headers['x-tenant-id'] as string,
  validateTenant: async (id) => checkTenantExists(id),
  onTenantResolved: (tenantId, request) => { /* ... */ },
});
```

| Option | Type | Description |
|--------|------|-------------|
| `manager` | `TenantManager` | Required. The tenant manager instance |
| `extractTenantId` | `(request) => string` | Required. Extract tenant ID from request |
| `validateTenant` | `(id) => Promise<boolean>` | Optional. Validate tenant exists |
| `onTenantResolved` | `(tenantId, request) => void` | Optional. Called when tenant is resolved |

## Request Decorators

The plugin decorates the request with:

| Property | Type | Description |
|----------|------|-------------|
| `request.tenantDb` | `DrizzleDb` | Tenant-scoped database instance |
| `request.tenantId` | `string` | Current tenant ID |

## Full Example

See the [Fastify example](/examples/fastify) for a complete working project.
