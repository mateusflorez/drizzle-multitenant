# Fastify Example

A multi-tenant project management API using Fastify.

## Features

- Fastify plugin for tenant context
- Users, Projects, and Tasks management
- Type-safe route handlers
- Connection retry with exponential backoff
- Built-in logging with Pino

## Project Structure

```
fastify/
├── src/
│   ├── index.ts      # Fastify app with routes
│   ├── config.ts     # drizzle-multitenant config
│   └── schema.ts     # Drizzle schema (users, projects, tasks)
├── drizzle/          # Generated migrations
├── package.json
└── tsconfig.json
```

## Plugin Setup

```typescript
import Fastify from 'fastify';
import { createTenantManager, createFastifyPlugin } from 'drizzle-multitenant';

const fastify = Fastify({ logger: true });
const tenants = createTenantManager(config);

fastify.register(createFastifyPlugin, {
  manager: tenants,
  extractTenantId: (request) => request.headers['x-tenant-id'] as string,
});
```

## Routes

```typescript
// List users
fastify.get('/users', async (request) => {
  const db = request.tenantDb!;
  return db.select().from(schema.users);
});

// Create project
fastify.post<{ Body: { name: string; description?: string } }>(
  '/projects',
  async (request, reply) => {
    const db = request.tenantDb!;
    const [project] = await db
      .insert(schema.projects)
      .values(request.body)
      .returning();
    return reply.status(201).send(project);
  }
);

// Get project tasks
fastify.get<{ Params: { projectId: string } }>(
  '/projects/:projectId/tasks',
  async (request) => {
    const db = request.tenantDb!;
    return db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, request.params.projectId));
  }
);
```

## API Endpoints

### Users

```bash
# Create user
curl -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"email": "alice@acme.com", "name": "Alice"}'

# List users
curl http://localhost:3001/users -H "X-Tenant-ID: acme"
```

### Projects

```bash
# Create project
curl -X POST http://localhost:3001/projects \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"name": "Website Redesign", "description": "Q1 project"}'

# List projects
curl http://localhost:3001/projects -H "X-Tenant-ID: acme"

# Get project by ID
curl http://localhost:3001/projects/{id} -H "X-Tenant-ID: acme"
```

### Tasks

```bash
# Create task
curl -X POST http://localhost:3001/projects/{projectId}/tasks \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"title": "Design mockups", "priority": 1}'

# List project tasks
curl http://localhost:3001/projects/{projectId}/tasks -H "X-Tenant-ID: acme"

# Complete task
curl -X PATCH http://localhost:3001/tasks/{id} \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"completed": true}'
```

## Source Code

[View on GitHub](https://github.com/mateusflorez/drizzle-multitenant/tree/main/examples/fastify)
