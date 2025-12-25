# Express.js Basic Example

A simple multi-tenant REST API using Express.js and drizzle-multitenant.

## Features

- Tenant isolation via PostgreSQL schemas
- Express middleware for automatic tenant context
- CRUD operations for users
- Connection retry with exponential backoff
- Pool management with LRU eviction

## Setup

1. **Start PostgreSQL**

```bash
# From the examples directory
cd ..
docker-compose up -d
```

2. **Install dependencies**

```bash
npm install
```

3. **Create tenant schemas**

```bash
# Using drizzle-multitenant CLI
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

## Usage

### Create a user

```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"email": "john@acme.com", "name": "John Doe"}'
```

### List users

```bash
# Tenant: acme
curl http://localhost:3000/users -H "X-Tenant-ID: acme"

# Tenant: globex (different schema, different data)
curl http://localhost:3000/users -H "X-Tenant-ID: globex"
```

### Get user by ID

```bash
curl http://localhost:3000/users/{id} -H "X-Tenant-ID: acme"
```

### Update user

```bash
curl -X PUT http://localhost:3000/users/{id} \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme" \
  -d '{"name": "John Updated", "active": false}'
```

### Delete user

```bash
curl -X DELETE http://localhost:3000/users/{id} -H "X-Tenant-ID: acme"
```

### Health check

```bash
curl http://localhost:3000/health
```

## Project Structure

```
express-basic/
├── src/
│   ├── index.ts      # Express app with routes
│   ├── config.ts     # drizzle-multitenant config
│   └── schema.ts     # Drizzle schema
├── drizzle/          # Generated migrations
├── package.json
└── tsconfig.json
```

## Key Concepts

### Tenant Context Middleware

```typescript
app.use(
  createExpressMiddleware({
    manager: tenants,
    context: tenantContext,
    extractTenantId: (req) => req.headers["x-tenant-id"] as string,
  })
);
```

### Accessing Tenant Database

```typescript
app.get("/users", async (req, res) => {
  const db = req.tenantContext!.db;
  const users = await db.select().from(schema.users);
  res.json(users);
});
```

### Async with Retry

```typescript
// Automatic retry with exponential backoff
const db = await tenants.getDbAsync(tenantId);
```
