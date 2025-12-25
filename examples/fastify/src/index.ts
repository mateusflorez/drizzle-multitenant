/**
 * Fastify Multi-tenant API Example
 *
 * Demonstrates:
 * - Fastify plugin for tenant context
 * - Type-safe routes with schemas
 * - Project management CRUD
 * - Async methods with retry
 */
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

    console.log(`
========================================
  Fastify Multi-tenant API
========================================
  Server running on http://localhost:${port}

  Try these commands:

  # Create a user
  curl -X POST http://localhost:${port}/users \\
    -H "Content-Type: application/json" \\
    -H "X-Tenant-ID: acme" \\
    -d '{"email": "alice@acme.com", "name": "Alice"}'

  # Create a project
  curl -X POST http://localhost:${port}/projects \\
    -H "Content-Type: application/json" \\
    -H "X-Tenant-ID: acme" \\
    -d '{"name": "Website Redesign", "description": "Q1 project"}'

  # List projects
  curl http://localhost:${port}/projects \\
    -H "X-Tenant-ID: acme"
========================================
    `);
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
