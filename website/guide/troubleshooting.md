# Troubleshooting

Common issues and solutions when using drizzle-multitenant.

## Pool Exhaustion

### Symptoms

```
Error: too many clients already
```

Or slow response times when handling many tenants concurrently.

### Cause

The `maxPools` limit has been reached and all pools are actively in use.

### Solutions

**1. Increase pool limit:**

```typescript
export default defineConfig({
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (id) => `tenant_${id}`,
    maxPools: 100, // Increase from default 50
  },
});
```

**2. Reduce pool TTL:**

```typescript
export default defineConfig({
  isolation: {
    // ...
    poolTtlMs: 30 * 60 * 1000, // 30 minutes instead of 1 hour
  },
});
```

**3. Reduce connections per pool:**

```typescript
export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    poolConfig: {
      max: 5, // Reduce from default 10
    },
  },
});
```

**4. Monitor pool usage:**

```typescript
// Check current pool count
console.log(`Active pools: ${tenants.getPoolCount()}`);
console.log(`Active tenants: ${tenants.getActiveTenantIds()}`);
```

## Context Not Available

### Symptoms

```
Error: [drizzle-multitenant] getTenantId() called outside of tenant context
```

### Cause

Calling `getTenantId()` or `getTenantDb()` outside of `runWithTenant()`.

### Solutions

**1. Check if in context first:**

```typescript
if (ctx.isInTenantContext()) {
  const db = ctx.getTenantDb();
  // ...
} else {
  // Handle non-tenant request
}
```

**2. Use nullable version:**

```typescript
const tenantId = ctx.getTenantIdOrNull();
if (tenantId) {
  // Tenant request
} else {
  // Public request
}
```

**3. Ensure middleware is applied:**

```typescript
// Express - apply before routes
app.use('/api', tenantMiddleware(config));
app.use('/api', routes);

// NestJS - use guards
@Controller('users')
@RequiresTenant()
export class UsersController {}
```

**4. Check async context preservation:**

```typescript
// Bad - context lost in setTimeout
ctx.runWithTenant({ tenantId: 'abc' }, () => {
  setTimeout(() => {
    ctx.getTenantId(); // Error!
  }, 100);
});

// Good - use async/await
ctx.runWithTenant({ tenantId: 'abc' }, async () => {
  await delay(100);
  ctx.getTenantId(); // Works
});
```

## Migration Format Mismatch

### Symptoms

```
Error: Migration 'xxx' not found in database table
```

Or migrations being re-applied when they shouldn't.

### Cause

Your migrations table uses a different format than expected.

### Solutions

**1. Check current format:**

```bash
npx drizzle-multitenant status --verbose
```

**2. Convert to consistent format:**

```bash
# Convert all tenants to 'name' format
npx drizzle-multitenant convert-format --to=name --all

# Dry run first
npx drizzle-multitenant convert-format --to=name --all --dry-run
```

**3. Set explicit format in config:**

```typescript
export default defineConfig({
  migrations: {
    tenantFolder: './drizzle/tenant',
    tableFormat: 'name', // or 'hash' or 'drizzle-kit'
  },
});
```

## Connection Errors

### Symptoms

```
Error: ECONNREFUSED 127.0.0.1:5432
Error: Connection terminated unexpectedly
Error: too many connections for role "postgres"
```

### Solutions

**1. Verify connection URL:**

```typescript
// Ensure URL is correct
console.log('Connecting to:', process.env.DATABASE_URL);

// URL format
// postgresql://user:password@host:port/database
```

**2. Enable retry for transient errors:**

```typescript
export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    retry: {
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      jitter: true,
      onRetry: (attempt, error, delay) => {
        console.log(`Retry ${attempt}: ${error.message}`);
      },
    },
  },
});
```

**3. Use async methods with retry:**

```typescript
// With retry logic
const db = await tenants.getDbAsync('tenant-123');

// Instead of sync (no retry)
const db = tenants.getDb('tenant-123');
```

**4. Check PostgreSQL limits:**

```sql
-- Check current connections
SELECT count(*) FROM pg_stat_activity;

-- Check max connections
SHOW max_connections;

-- Increase if needed (requires restart)
ALTER SYSTEM SET max_connections = 200;
```

## Schema Not Found

### Symptoms

```
Error: schema "tenant_abc" does not exist
```

### Cause

Trying to access a tenant before its schema is created.

### Solutions

**1. Create schema before use:**

```bash
npx drizzle-multitenant tenant:create --id=abc
```

**2. Auto-create in application:**

```typescript
import { sql } from 'drizzle-orm';

async function ensureTenantSchema(tenantId: string) {
  const schemaName = tenants.getSchemaName(tenantId);
  const shared = tenants.getSharedDb();

  await shared.execute(sql`
    CREATE SCHEMA IF NOT EXISTS ${sql.identifier(schemaName)}
  `);

  // Run migrations
  const migrator = createMigrator(config);
  await migrator.migrate([tenantId]);
}
```

**3. Validate tenant exists:**

```typescript
const tenantMiddleware = async (req, res, next) => {
  const tenantId = req.headers['x-tenant-id'];

  // Check if tenant is valid (from your registry)
  const exists = await tenantRegistry.exists(tenantId);
  if (!exists) {
    return res.status(404).json({ error: 'Tenant not found' });
  }

  next();
};
```

## Slow Queries

### Symptoms

Requests taking longer than expected, especially first requests.

### Solutions

**1. Enable debug mode:**

```typescript
export default defineConfig({
  debug: {
    enabled: true,
    logQueries: true,
    slowQueryThreshold: 500, // Log queries over 500ms
  },
});
```

**2. Pre-warm pools:**

```typescript
// On application startup
const tenantIds = await getTenantIds();
await tenants.warmup(tenantIds, {
  concurrency: 10,
  onProgress: (id, status) => console.log(`${id}: ${status}`),
});
```

**3. Check indexes:**

```sql
-- Find slow queries
SELECT query, calls, mean_time, total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Check missing indexes
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname LIKE 'tenant_%';
```

## NestJS Circular Dependencies

### Symptoms

```
Error: Nest cannot resolve dependencies of the Service
```

### Cause

Using `@InjectTenantDb()` in singleton services.

### Solution

Use `TenantDbFactory` for singleton services:

```typescript
@Injectable()
export class SingletonService {
  constructor(
    @InjectTenantDbFactory()
    private readonly dbFactory: TenantDbFactory,
  ) {}

  async getUsers(tenantId: string) {
    const db = this.dbFactory.getDb(tenantId);
    return db.select().from(users);
  }
}
```

See [NestJS Integration](/guide/frameworks/nestjs#singleton-services) for details.

## Debug Checklist

When troubleshooting, gather this information:

```typescript
// 1. Version info
console.log('drizzle-multitenant version:', require('drizzle-multitenant/package.json').version);

// 2. Pool status
console.log('Pool count:', tenants.getPoolCount());
console.log('Active tenants:', tenants.getActiveTenantIds());

// 3. Retry config
console.log('Retry config:', tenants.getRetryConfig());

// 4. Enable debug mode
export default defineConfig({
  debug: {
    enabled: true,
    logQueries: true,
    logPoolEvents: true,
  },
});
```

## Getting Help

If you're still stuck:

1. Check the [GitHub Issues](https://github.com/mateusflorez/drizzle-multitenant/issues)
2. Search for similar problems
3. Open a new issue with:
   - Node.js version
   - PostgreSQL version
   - drizzle-multitenant version
   - Minimal reproduction code
   - Full error message and stack trace
