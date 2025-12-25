# NestJS Example

A multi-tenant e-commerce API using NestJS.

## Features

- TenantModule with dependency injection
- `@InjectTenantDb()` decorator for services
- `@RequiresTenant()` guard decorator
- Users and Orders management
- Proper NestJS architecture (modules, controllers, services)

## Project Structure

```
nestjs/
├── src/
│   ├── main.ts                 # Bootstrap
│   ├── app.module.ts           # Root module with TenantModule
│   ├── tenant.config.ts        # drizzle-multitenant config
│   ├── schema.ts               # Drizzle schema
│   ├── health.controller.ts    # Health endpoints
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   └── users.service.ts
│   └── orders/
│       ├── orders.module.ts
│       ├── orders.controller.ts
│       └── orders.service.ts
├── package.json
├── tsconfig.json
└── nest-cli.json
```

## Module Setup

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { TenantModule } from 'drizzle-multitenant/nestjs';

@Module({
  imports: [
    TenantModule.forRoot({
      config: tenantConfig,
      extractTenantId: (request) => request.headers['x-tenant-id'],
      global: true,
    }),
    UsersModule,
    OrdersModule,
  ],
})
export class AppModule {}
```

## Service with Tenant DB

```typescript
// users.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTenantDb } from 'drizzle-multitenant/nestjs';

@Injectable()
export class UsersService {
  constructor(
    @InjectTenantDb()
    private readonly db: PostgresJsDatabase<typeof schema>
  ) {}

  async findAll() {
    return this.db.select().from(schema.users);
  }

  async create(data: { email: string; name: string }) {
    const [user] = await this.db
      .insert(schema.users)
      .values(data)
      .returning();
    return user;
  }
}
```

## Controller with Guards

```typescript
// users.controller.ts
import { Controller, Get, Post, Body } from '@nestjs/common';
import { RequiresTenant } from 'drizzle-multitenant/nestjs';

@Controller('users')
@RequiresTenant()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  create(@Body() data: { email: string; name: string }) {
    return this.usersService.create(data);
  }
}
```

## Public Routes

```typescript
// health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { PublicRoute, InjectTenantManager } from 'drizzle-multitenant/nestjs';

@Controller()
export class HealthController {
  constructor(@InjectTenantManager() private manager: TenantManager) {}

  @Get('health')
  @PublicRoute()
  health() {
    return {
      status: 'ok',
      pools: this.manager.getPoolCount(),
    };
  }
}
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

# Update user
curl -X PUT http://localhost:3002/users/{id} \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"role": "manager"}'
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

# Complete order
curl -X POST http://localhost:3002/orders/{id}/complete -H "X-Tenant-ID: acme"
```

### Health

```bash
# Health check (no tenant required)
curl http://localhost:3002/health

# Pool stats
curl http://localhost:3002/admin/pools
```

## Source Code

[View on GitHub](https://github.com/mateusflorez/drizzle-multitenant/tree/main/examples/nestjs)
