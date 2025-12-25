# Examples

Sample projects demonstrating drizzle-multitenant with different frameworks.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/mateusflorez/drizzle-multitenant.git
cd drizzle-multitenant/examples

# Start PostgreSQL
docker-compose up -d

# Choose an example
cd express-basic  # or fastify, nestjs

# Install and run
npm install
npm run dev
```

## Available Examples

| Example | Framework | Port | Description |
|---------|-----------|------|-------------|
| [Express](/examples/express) | Express.js | 3000 | Simple REST API with CRUD |
| [Fastify](/examples/fastify) | Fastify | 3001 | Project management API |
| [NestJS](/examples/nestjs) | NestJS | 3002 | E-commerce with modules |

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

### Express
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

## Clean Up

```bash
# Stop PostgreSQL
docker-compose down

# Remove data volume
docker-compose down -v
```
