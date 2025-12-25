# Fastify Example

A multi-tenant project management API using Fastify.

## Features

- Fastify plugin for tenant context
- Type-safe routes
- Project and Task management
- User relationships
- Connection retry with exponential backoff

## Schema

```typescript
// schema.ts
import { pgTable, uuid, varchar, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  description: varchar("description", { length: 1000 }),
  ownerId: uuid("owner_id").references(() => users.id),
  status: varchar("status", { length: 50 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  projectId: uuid("project_id").references(() => projects.id),
  assigneeId: uuid("assignee_id").references(() => users.id),
  priority: integer("priority").default(0),
  completed: boolean("completed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Type exports
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
```

## Configuration

```typescript
// config.ts
import { defineConfig } from "drizzle-multitenant";
import * as schema from "./schema.js";

export const config = defineConfig({
  connection: {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/multitenant",
    pooling: {
      max: 20,
      idleTimeoutMillis: 30000,
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
    },
  },
  isolation: {
    strategy: "schema",
    schemaNameTemplate: (tenantId) => `tenant_${tenantId}`,
    maxPools: 100,
    poolTtlMs: 60 * 60 * 1000,
  },
  schemas: {
    tenant: schema,
    shared: schema,
  },
  hooks: {
    onPoolCreated: (tenantId) => {
      console.log(`[Pool] Created: ${tenantId}`);
    },
  },
  debug: {
    enabled: process.env.NODE_ENV === "development",
    logQueries: true,
    logPoolEvents: true,
  },
});

export { schema };
```

## Application

```typescript
// index.ts
import Fastify from "fastify";
import { createTenantManager, createFastifyPlugin } from "drizzle-multitenant";
import { eq } from "drizzle-orm";
import { config, schema } from "./config.js";

const fastify = Fastify({ logger: true });

// Create tenant manager
const tenants = createTenantManager(config);

// Register tenant plugin
fastify.register(createFastifyPlugin, {
  manager: tenants,
  extractTenantId: (request) => request.headers["x-tenant-id"] as string,
  onTenantResolved: (tenantId, request) => {
    request.log.info({ tenantId }, "Tenant resolved");
  },
});

// Health check
fastify.get("/health", async () => {
  return { status: "ok", pools: tenants.getPoolCount() };
});

// === Users Routes ===

fastify.get("/users", async (request) => {
  const db = request.tenantDb!;
  return db.select().from(schema.users);
});

fastify.post<{ Body: { email: string; name: string } }>("/users", async (request, reply) => {
  const db = request.tenantDb!;
  const { email, name } = request.body;

  const [user] = await db.insert(schema.users).values({ email, name }).returning();

  return reply.status(201).send(user);
});

// === Projects Routes ===

fastify.get("/projects", async (request) => {
  const db = request.tenantDb!;
  return db.select().from(schema.projects);
});

fastify.post<{ Body: { name: string; description?: string; ownerId?: string } }>(
  "/projects",
  async (request, reply) => {
    const db = request.tenantDb!;
    const { name, description, ownerId } = request.body;

    const [project] = await db
      .insert(schema.projects)
      .values({ name, description, ownerId })
      .returning();

    return reply.status(201).send(project);
  }
);

fastify.get<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
  const db = request.tenantDb!;
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, request.params.id));

  if (!project) {
    return reply.status(404).send({ error: "Project not found" });
  }
  return project;
});

// === Tasks Routes ===

fastify.get("/tasks", async (request) => {
  const db = request.tenantDb!;
  return db.select().from(schema.tasks);
});

fastify.get<{ Params: { projectId: string } }>("/projects/:projectId/tasks", async (request) => {
  const db = request.tenantDb!;
  return db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, request.params.projectId));
});

fastify.post<{
  Params: { projectId: string };
  Body: { title: string; assigneeId?: string; priority?: number };
}>("/projects/:projectId/tasks", async (request, reply) => {
  const db = request.tenantDb!;
  const { title, assigneeId, priority } = request.body;

  const [task] = await db
    .insert(schema.tasks)
    .values({
      title,
      projectId: request.params.projectId,
      assigneeId,
      priority,
    })
    .returning();

  return reply.status(201).send(task);
});

fastify.patch<{ Params: { id: string }; Body: { completed?: boolean; priority?: number } }>(
  "/tasks/:id",
  async (request, reply) => {
    const db = request.tenantDb!;
    const { completed, priority } = request.body;

    const [task] = await db
      .update(schema.tasks)
      .set({ completed, priority })
      .where(eq(schema.tasks.id, request.params.id))
      .returning();

    if (!task) {
      return reply.status(404).send({ error: "Task not found" });
    }
    return task;
  }
);

// === Admin Routes ===

fastify.get("/admin/stats", async () => {
  return {
    poolCount: tenants.getPoolCount(),
    timestamp: new Date().toISOString(),
  };
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "3001");
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`Fastify Multi-tenant API running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

// Graceful shutdown
process.on("SIGTERM", async () => {
  await fastify.close();
  await tenants.dispose();
  process.exit(0);
});
```

## API Endpoints

```bash
# Create a user
curl -X POST http://localhost:3001/users \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"email": "alice@acme.com", "name": "Alice"}'

# Create a project
curl -X POST http://localhost:3001/projects \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"name": "Website Redesign", "description": "Q1 project"}'

# List projects
curl http://localhost:3001/projects -H "X-Tenant-ID: acme"

# Create a task
curl -X POST http://localhost:3001/projects/{projectId}/tasks \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"title": "Design mockups", "priority": 1}'

# List tasks for project
curl http://localhost:3001/projects/{projectId}/tasks -H "X-Tenant-ID: acme"

# Update task status
curl -X PATCH http://localhost:3001/tasks/{id} \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"completed": true}'

# Health check
curl http://localhost:3001/health
```

## package.json

```json
{
  "name": "fastify-example",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "npx drizzle-multitenant migrate --all"
  },
  "dependencies": {
    "drizzle-multitenant": "^1.0.8",
    "drizzle-orm": "^0.29.0",
    "fastify": "^4.24.0",
    "pg": "^8.11.0"
  },
  "devDependencies": {
    "@types/pg": "^8.10.0",
    "drizzle-kit": "^0.20.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```
