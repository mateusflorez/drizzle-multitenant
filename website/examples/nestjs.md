# NestJS Example

A multi-tenant e-commerce API using NestJS.

## Features

- TenantModule with dependency injection
- `@InjectTenantDb()` decorator for services
- `@RequiresTenant()` guard decorator
- Users and Orders management
- Proper NestJS architecture (modules, controllers, services)

## Schema

```typescript
// schema.ts
import { pgTable, uuid, varchar, timestamp, boolean, integer, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).default("user"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  status: varchar("status", { length: 50 }).default("pending"),
  total: integer("total").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id),
  productName: varchar("product_name", { length: 255 }).notNull(),
  quantity: integer("quantity").default(1),
  price: integer("price").default(0),
});

// Shared tables (public schema)
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  maxUsers: integer("max_users"),
  price: integer("price"),
});

// Type exports
export type User = typeof users.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Plan = typeof plans.$inferSelect;
```

## Configuration

```typescript
// tenant.config.ts
import { defineConfig } from "drizzle-multitenant";
import * as schema from "./schema";

export const tenantConfig = defineConfig({
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
      console.log(`[TenantModule] Pool created: ${tenantId}`);
    },
    onPoolEvicted: (tenantId) => {
      console.log(`[TenantModule] Pool evicted: ${tenantId}`);
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

## App Module

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { TenantModule } from "drizzle-multitenant/nestjs";
import { tenantConfig } from "./tenant.config";
import { UsersModule } from "./users/users.module";
import { OrdersModule } from "./orders/orders.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    TenantModule.forRoot({
      config: tenantConfig,
      extractTenantId: (request) => request.headers["x-tenant-id"] as string,
      global: true,
    }),
    UsersModule,
    OrdersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
```

## Users Service

```typescript
// users/users.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectTenantDb } from "drizzle-multitenant/nestjs";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../schema";

@Injectable()
export class UsersService {
  constructor(
    @InjectTenantDb()
    private readonly db: PostgresJsDatabase<typeof schema>
  ) {}

  async findAll() {
    return this.db.select().from(schema.users);
  }

  async findOne(id: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));

    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
  }

  async create(data: { email: string; name: string; role?: string }) {
    const [user] = await this.db
      .insert(schema.users)
      .values({
        email: data.email,
        name: data.name,
        role: data.role || "user",
      })
      .returning();

    return user;
  }

  async update(id: string, data: { name?: string; role?: string; active?: boolean }) {
    const [user] = await this.db
      .update(schema.users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();

    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
  }

  async remove(id: string) {
    const [user] = await this.db
      .delete(schema.users)
      .where(eq(schema.users.id, id))
      .returning();

    if (!user) {
      throw new NotFoundException("User not found");
    }
    return { deleted: true };
  }
}
```

## Users Controller

```typescript
// users/users.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param } from "@nestjs/common";
import { RequiresTenant } from "drizzle-multitenant/nestjs";
import { UsersService } from "./users.service";

@Controller("users")
@RequiresTenant()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() data: { email: string; name: string; role?: string }) {
    return this.usersService.create(data);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() data: { name?: string; role?: string; active?: boolean }) {
    return this.usersService.update(id, data);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }
}
```

## Health Controller

```typescript
// health.controller.ts
import { Controller, Get } from "@nestjs/common";
import { PublicRoute, InjectTenantManager } from "drizzle-multitenant/nestjs";
import type { TenantManager } from "drizzle-multitenant";

@Controller()
export class HealthController {
  constructor(
    @InjectTenantManager()
    private readonly manager: TenantManager
  ) {}

  @Get("health")
  @PublicRoute()
  health() {
    return {
      status: "ok",
      pools: this.manager.getPoolCount(),
      timestamp: new Date().toISOString(),
    };
  }
}
```

## Main Bootstrap

```typescript
// main.ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3002;
  await app.listen(port);

  console.log(`NestJS Multi-tenant API running on http://localhost:${port}`);
}

bootstrap();
```

## API Endpoints

### Users

```bash
# Create user
curl -X POST http://localhost:3002/users \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"email": "bob@acme.com", "name": "Bob", "role": "admin"}'

# List users
curl http://localhost:3002/users -H "X-Tenant-ID: acme"

# Get user by ID
curl http://localhost:3002/users/{id} -H "X-Tenant-ID: acme"

# Update user
curl -X PUT http://localhost:3002/users/{id} \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"role": "manager"}'

# Delete user
curl -X DELETE http://localhost:3002/users/{id} -H "X-Tenant-ID: acme"
```

### Orders

```bash
# Create order with items
curl -X POST http://localhost:3002/orders \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{
    "userId": "{user-id}",
    "items": [
      {"productName": "Widget", "quantity": 2, "price": 1999},
      {"productName": "Gadget", "quantity": 1, "price": 4999}
    ]
  }'

# List orders
curl http://localhost:3002/orders -H "X-Tenant-ID: acme"

# Get order with items
curl http://localhost:3002/orders/{id} -H "X-Tenant-ID: acme"
```

### Health

```bash
# Health check (no tenant required)
curl http://localhost:3002/health
```

## package.json

```json
{
  "name": "nestjs-example",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "npx drizzle-multitenant migrate --all"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "drizzle-multitenant": "^1.0.8",
    "drizzle-orm": "^0.29.0",
    "pg": "^8.11.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@types/pg": "^8.10.0",
    "drizzle-kit": "^0.20.0",
    "typescript": "^5.0.0"
  }
}
```
