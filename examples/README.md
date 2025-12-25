# Examples

Sample projects demonstrating drizzle-multitenant with different frameworks.

## Quick Start

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Choose an example
cd express-basic  # or fastify, nestjs

# 3. Install and run
npm install
npm run dev
```

## Available Examples

| Example | Framework | Port | Description |
|---------|-----------|------|-------------|
| [express-basic](./express-basic) | Express.js | 3000 | Simple REST API with CRUD |
| [fastify](./fastify) | Fastify | 3001 | Project management API |
| [nestjs](./nestjs) | NestJS | 3002 | E-commerce with modules |

## Common Setup

All examples share the same PostgreSQL instance:

```bash
# Start database
docker-compose up -d

# Create tenants (from any example folder)
npx drizzle-multitenant tenant:create --id=acme
npx drizzle-multitenant tenant:create --id=globex

# Generate and apply migrations
npm run db:generate
npm run db:migrate
```

## Testing Tenant Isolation

Each tenant has its own schema. Data created for one tenant is invisible to others:

```bash
# Create user in tenant 'acme'
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"email": "john@acme.com", "name": "John"}'

# List users in 'acme' - returns John
curl http://localhost:3000/users -H "X-Tenant-ID: acme"

# List users in 'globex' - returns empty (different schema)
curl http://localhost:3000/users -H "X-Tenant-ID: globex"
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/multitenant` | PostgreSQL connection |
| `PORT` | 3000/3001/3002 | Server port |
| `NODE_ENV` | - | Set to `development` for debug logs |

## Features Demonstrated

### Express Basic
- Express middleware (`createExpressMiddleware`)
- Tenant context via `req.tenantContext`
- Async methods with retry (`getDbAsync`)

### Fastify
- Fastify plugin (`createFastifyPlugin`)
- Tenant database via `request.tenantDb`
- Project/Task relationships

### NestJS
- Module registration (`TenantModule.forRoot`)
- Decorators (`@InjectTenantDb`, `@RequiresTenant`, `@PublicRoute`)
- Service-based architecture
- Orders with items

## Project Structure

```
examples/
├── docker-compose.yml     # Shared PostgreSQL
├── shared/
│   └── schema.ts          # Shared schema reference
├── express-basic/
│   ├── src/
│   │   ├── index.ts       # Express app
│   │   ├── config.ts      # Tenant config
│   │   └── schema.ts      # Drizzle schema
│   └── package.json
├── fastify/
│   ├── src/
│   │   ├── index.ts       # Fastify app
│   │   ├── config.ts      # Tenant config
│   │   └── schema.ts      # Drizzle schema
│   └── package.json
└── nestjs/
    ├── src/
    │   ├── main.ts        # Bootstrap
    │   ├── app.module.ts  # Root module
    │   ├── tenant.config.ts
    │   ├── schema.ts
    │   ├── users/         # Users module
    │   └── orders/        # Orders module
    └── package.json
```

## Clean Up

```bash
# Stop PostgreSQL
docker-compose down

# Remove data volume
docker-compose down -v
```
