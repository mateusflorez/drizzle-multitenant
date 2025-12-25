# NestJS Example

A multi-tenant e-commerce API using NestJS and drizzle-multitenant.

## Features

- TenantModule with dependency injection
- `@InjectTenantDb()` decorator for services
- `@RequiresTenant()` guard decorator
- Users and Orders management
- Proper NestJS architecture (modules, controllers, services)

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
curl -X POST http://localhost:3002/users \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"email": "bob@acme.com", "name": "Bob", "role": "admin"}'

# List users
curl http://localhost:3002/users -H "X-Tenant-ID: acme"

# Get user
curl http://localhost:3002/users/{id} -H "X-Tenant-ID: acme"

# Update user
curl -X PUT http://localhost:3002/users/{id} \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"role": "manager", "active": true}'
```

### Orders

```bash
# Create order with items
curl -X POST http://localhost:3002/orders \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{
    "userId": "{user-id}",
    "notes": "Rush delivery",
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

# Cancel order
curl -X POST http://localhost:3002/orders/{id}/cancel -H "X-Tenant-ID: acme"
```

### Health

```bash
# Health check (no tenant required)
curl http://localhost:3002/health

# Pool stats
curl http://localhost:3002/admin/pools
```

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

## Key Concepts

### TenantModule Registration

```typescript
@Module({
  imports: [
    TenantModule.forRoot({
      config: tenantConfig,
      extractTenantId: (request) => request.headers["x-tenant-id"],
      global: true,
    }),
  ],
})
export class AppModule {}
```

### Injecting Tenant Database

```typescript
@Injectable()
export class UsersService {
  constructor(
    @InjectTenantDb()
    private readonly db: PostgresJsDatabase<typeof schema>
  ) {}

  async findAll() {
    return this.db.select().from(schema.users);
  }
}
```

### Protecting Routes

```typescript
@Controller("users")
@RequiresTenant() // Requires X-Tenant-ID header
export class UsersController {
  // ...
}
```

### Public Routes

```typescript
@Get("health")
@PublicRoute() // No tenant required
health() {
  return { status: "ok" };
}
```
