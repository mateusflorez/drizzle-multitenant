# Express Example

A complete multi-tenant REST API using Express.js.

## Features

- Tenant isolation via PostgreSQL schemas
- Express middleware for automatic tenant context
- CRUD operations for users
- Connection retry with exponential backoff
- Pool management with LRU eviction

## Schema

```typescript
// schema.ts
import { pgTable, uuid, varchar, timestamp, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  content: varchar("content", { length: 5000 }),
  authorId: uuid("author_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Shared tables (in public schema)
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  maxUsers: varchar("max_users", { length: 50 }),
  price: varchar("price", { length: 50 }),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type Plan = typeof plans.$inferSelect;
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
      max: 10,
      idleTimeoutMillis: 30000,
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
      onRetry: (attempt, error, delay) => {
        console.log(`[Retry] Attempt ${attempt}, waiting ${delay}ms: ${error.message}`);
      },
    },
  },
  isolation: {
    strategy: "schema",
    schemaNameTemplate: (tenantId) => `tenant_${tenantId}`,
    maxPools: 50,
    poolTtlMs: 60 * 60 * 1000,
  },
  schemas: {
    tenant: schema,
    shared: schema,
  },
  hooks: {
    onPoolCreated: (tenantId) => {
      console.log(`[Pool] Created for tenant: ${tenantId}`);
    },
    onPoolEvicted: (tenantId) => {
      console.log(`[Pool] Evicted for tenant: ${tenantId}`);
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

// Apply tenant middleware
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

// Using async method with retry
app.get("/users-async", async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
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
  res.json({ count: tenants.getPoolCount() });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Express Multi-tenant API running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await tenants.dispose();
  process.exit(0);
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

# With async retry
curl http://localhost:3000/users-async -H "X-Tenant-ID: acme"
```

## package.json

```json
{
  "name": "express-basic",
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
    "express": "^4.18.0",
    "pg": "^8.11.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/pg": "^8.10.0",
    "drizzle-kit": "^0.20.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```
