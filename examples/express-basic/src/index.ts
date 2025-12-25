/**
 * Express.js Multi-tenant API Example
 *
 * Demonstrates:
 * - Express middleware for tenant context
 * - CRUD operations within tenant schema
 * - Async methods with retry
 * - Pool management
 */
import express from "express";
import {
  createTenantManager,
  createExpressMiddleware,
  createTenantContext,
} from "drizzle-multitenant";
import { eq } from "drizzle-orm";
import { config, schema } from "./config.js";

const app = express();
app.use(express.json());

// Create tenant manager and context
const tenants = createTenantManager(config);
const tenantContext = createTenantContext();

// Apply tenant middleware - extracts tenant from X-Tenant-ID header
app.use(
  createExpressMiddleware({
    manager: tenants,
    context: tenantContext,
    extractTenantId: (req) => req.headers["x-tenant-id"] as string,
    onTenantResolved: (tenantId) => {
      console.log(`[Request] Tenant: ${tenantId}`);
    },
  })
);

// Health check (no tenant required)
app.get("/health", async (_req, res) => {
  const poolCount = tenants.getPoolCount();
  res.json({ status: "ok", pools: poolCount });
});

// List users for current tenant
app.get("/users", async (req, res) => {
  try {
    const db = req.tenantContext!.db;
    const users = await db.select().from(schema.users);
    res.json(users);
  } catch (error) {
    console.error("Error listing users:", error);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// Create user
app.post("/users", async (req, res) => {
  try {
    const db = req.tenantContext!.db;
    const { email, name } = req.body;

    const [user] = await db
      .insert(schema.users)
      .values({ email, name })
      .returning();

    res.status(201).json(user);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Get user by ID
app.get("/users/:id", async (req, res) => {
  try {
    const db = req.tenantContext!.db;
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, req.params.id));

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error("Error getting user:", error);
    res.status(500).json({ error: "Failed to get user" });
  }
});

// Update user
app.put("/users/:id", async (req, res) => {
  try {
    const db = req.tenantContext!.db;
    const { email, name, active } = req.body;

    const [user] = await db
      .update(schema.users)
      .set({ email, name, active })
      .where(eq(schema.users.id, req.params.id))
      .returning();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Delete user
app.delete("/users/:id", async (req, res) => {
  try {
    const db = req.tenantContext!.db;
    const [user] = await db
      .delete(schema.users)
      .where(eq(schema.users.id, req.params.id))
      .returning();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// Example: Using async method with retry
app.get("/users-async", async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    // getDbAsync includes automatic retry with exponential backoff
    const db = await tenants.getDbAsync(tenantId);
    const users = await db.select().from(schema.users);
    res.json(users);
  } catch (error) {
    console.error("Error with async method:", error);
    res.status(500).json({ error: "Failed to get users" });
  }
});

// Pool statistics
app.get("/admin/pools", async (_req, res) => {
  res.json({
    count: tenants.getPoolCount(),
    // Add more stats as needed
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
========================================
  Express Multi-tenant API
========================================
  Server running on http://localhost:${PORT}

  Try these commands:

  # Create a user (tenant: acme)
  curl -X POST http://localhost:${PORT}/users \\
    -H "Content-Type: application/json" \\
    -H "X-Tenant-ID: acme" \\
    -d '{"email": "john@acme.com", "name": "John Doe"}'

  # List users (tenant: acme)
  curl http://localhost:${PORT}/users \\
    -H "X-Tenant-ID: acme"

  # List users (different tenant: globex)
  curl http://localhost:${PORT}/users \\
    -H "X-Tenant-ID: globex"
========================================
`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await tenants.dispose();
  process.exit(0);
});
