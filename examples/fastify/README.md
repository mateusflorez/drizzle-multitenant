# Fastify Example

A multi-tenant project management API using Fastify and drizzle-multitenant.

## Features

- Fastify plugin for tenant context
- Users, Projects, and Tasks management
- Type-safe route handlers
- Connection retry with exponential backoff
- Built-in logging with Pino

## Setup

1. **Start PostgreSQL**

```bash
cd ..
docker-compose up -d
```

2. **Install dependencies**

```bash
npm install
```

3. **Create tenant schemas**

```bash
npx drizzle-multitenant tenant:create --id=acme
npx drizzle-multitenant tenant:create --id=globex
```

4. **Run migrations**

```bash
npm run db:generate
npm run db:migrate
```

5. **Start the server**

```bash
npm run dev
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
# Create task for project
curl -X POST http://localhost:3001/projects/{projectId}/tasks \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"title": "Design mockups", "priority": 1}'

# List project tasks
curl http://localhost:3001/projects/{projectId}/tasks -H "X-Tenant-ID: acme"

# Update task
curl -X PATCH http://localhost:3001/tasks/{id} \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"completed": true}'
```

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

## Key Concepts

### Fastify Plugin

```typescript
fastify.register(createFastifyPlugin, {
  manager: tenants,
  extractTenantId: (request) => request.headers["x-tenant-id"] as string,
});
```

### Accessing Tenant Database

```typescript
fastify.get("/users", async (request) => {
  const db = request.tenantDb!;
  return db.select().from(schema.users);
});
```
