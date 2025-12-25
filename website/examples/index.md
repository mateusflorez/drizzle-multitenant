# Examples

Complete examples demonstrating drizzle-multitenant with different frameworks.

## Prerequisites

Start PostgreSQL with Docker:

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    container_name: drizzle-multitenant-examples
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: multitenant
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

```bash
docker-compose up -d
```

## Available Examples

| Example | Framework | Description |
|---------|-----------|-------------|
| [Express](/examples/express) | Express.js | REST API with CRUD and retry |
| [Fastify](/examples/fastify) | Fastify | Project management API |
| [NestJS](/examples/nestjs) | NestJS | E-commerce with modules |

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
