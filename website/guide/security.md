# Security

Best practices for secure multi-tenant applications with drizzle-multitenant.

## Schema Isolation Guarantees

PostgreSQL schema isolation provides strong data separation:

```
Database
├── public (shared tables)
│   ├── plans
│   └── features
├── tenant_acme (Tenant A data)
│   ├── users
│   └── orders
└── tenant_globex (Tenant B data)
    ├── users
    └── orders
```

### How It Works

Each tenant connection sets a specific `search_path`:

```sql
-- Tenant 'acme' connection
SET search_path TO tenant_acme, public;

-- Queries automatically use tenant schema first
SELECT * FROM users;  -- Uses tenant_acme.users
SELECT * FROM plans;  -- Falls back to public.plans
```

### Guarantees

| Aspect | Guarantee |
|--------|-----------|
| Data Access | Tenant can only access their own schema |
| Table Names | Same table names across tenants (no conflicts) |
| Indexes | Per-schema indexes (no cross-tenant impact) |
| Migrations | Applied independently per schema |

### Limitations

Schema isolation does **not** protect against:
- SQL injection (tenant ID in query)
- Application bugs that bypass the middleware
- Direct database access with superuser credentials
- Cross-schema joins without proper validation

## Tenant ID Validation

**Never trust tenant IDs from user input without validation.**

### Bad Practice

```typescript
// DANGEROUS - No validation
app.use((req, res, next) => {
  const tenantId = req.headers['x-tenant-id'];
  ctx.runWithTenant({ tenantId }, next); // SQL injection risk!
});
```

### Good Practice

```typescript
// Safe - Validate tenant ID format
const TENANT_ID_REGEX = /^[a-z0-9-]{3,36}$/;

function validateTenantId(tenantId: unknown): string {
  if (typeof tenantId !== 'string') {
    throw new Error('Tenant ID must be a string');
  }

  if (!TENANT_ID_REGEX.test(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }

  return tenantId;
}

app.use((req, res, next) => {
  try {
    const tenantId = validateTenantId(req.headers['x-tenant-id']);
    ctx.runWithTenant({ tenantId }, next);
  } catch (error) {
    res.status(400).json({ error: 'Invalid tenant ID' });
  }
});
```

### Recommended Validation Rules

| Rule | Example |
|------|---------|
| Alphanumeric + hyphen only | `^[a-z0-9-]+$` |
| Minimum length | 3 characters |
| Maximum length | 36 characters (UUID length) |
| No special SQL characters | No `;`, `'`, `"`, `--` |

## Authentication Integration

### Validate Tenant Ownership

Always verify the user has access to the requested tenant:

```typescript
interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    tenants: string[]; // Tenants user has access to
  };
}

app.use(async (req: AuthenticatedRequest, res, next) => {
  const tenantId = req.headers['x-tenant-id'];

  // 1. Validate format
  if (!isValidTenantId(tenantId)) {
    return res.status(400).json({ error: 'Invalid tenant ID' });
  }

  // 2. Check user has access to this tenant
  if (!req.user.tenants.includes(tenantId)) {
    return res.status(403).json({ error: 'Access denied to tenant' });
  }

  // 3. Run with validated tenant
  ctx.runWithTenant({ tenantId }, next);
});
```

### JWT with Tenant Claims

```typescript
interface TokenPayload {
  sub: string;
  tenantId: string; // Tenant embedded in token
  roles: string[];
}

app.use((req, res, next) => {
  const token = verifyJWT(req.headers.authorization);

  // Tenant from token is already validated during auth
  const tenantId = token.tenantId;

  // Optional: Allow override only for super admins
  if (token.roles.includes('super_admin')) {
    const override = req.headers['x-tenant-id'];
    if (override && isValidTenantId(override)) {
      return ctx.runWithTenant({ tenantId: override }, next);
    }
  }

  ctx.runWithTenant({ tenantId }, next);
});
```

## Schema Name Security

### Prevent Schema Injection

The `schemaNameTemplate` function must produce safe schema names:

```typescript
// DANGEROUS - Direct interpolation
schemaNameTemplate: (id) => `tenant_${id}`,
// If id = "abc; DROP SCHEMA public" -> SQL injection!

// SAFE - Sanitize input
schemaNameTemplate: (id) => {
  const sanitized = id.replace(/[^a-z0-9_]/gi, '');
  if (sanitized.length === 0) {
    throw new Error('Invalid tenant ID for schema name');
  }
  return `tenant_${sanitized}`;
},
```

### Use UUIDs or Hashes

For maximum security, use non-guessable schema names:

```typescript
import { createHash } from 'crypto';

schemaNameTemplate: (id) => {
  const hash = createHash('sha256')
    .update(id)
    .digest('hex')
    .slice(0, 12);
  return `t_${hash}`;
},

// tenant_123 becomes t_a665a45920
```

## Row-Level Security Comparison

| Aspect | Schema Isolation | Row-Level Security (RLS) |
|--------|-----------------|--------------------------|
| **Data Separation** | Physical (separate schemas) | Logical (same tables) |
| **Performance** | Better for large tenants | Better for many small tenants |
| **Complexity** | Simple | Requires RLS policies |
| **Backup/Restore** | Per-tenant possible | All-or-nothing |
| **Cross-tenant Queries** | Requires explicit joins | Filtered automatically |
| **PostgreSQL Version** | Any | 9.5+ |

### When to Use Schema Isolation

- Tenants have significant data volume
- Need per-tenant backup/restore
- Regulatory requirements for data separation
- Different schema versions per tenant

### When to Consider RLS

- Thousands of small tenants
- Shared analytics across tenants
- Simpler deployment (single schema)
- Frequent cross-tenant operations

## Security Checklist

### Configuration

- [ ] Validate tenant ID format before use
- [ ] Sanitize schema name generation
- [ ] Use separate database user per environment
- [ ] Enable SSL for database connections

### Middleware

- [ ] Apply tenant middleware before all routes
- [ ] Verify user has access to requested tenant
- [ ] Log tenant context in all requests
- [ ] Handle missing tenant gracefully

### Database

- [ ] Use least-privilege database roles
- [ ] Separate roles for migrations vs runtime
- [ ] Audit schema creation/deletion
- [ ] Regular backup verification

### Monitoring

- [ ] Log cross-schema query attempts
- [ ] Alert on unusual tenant access patterns
- [ ] Track failed tenant validations
- [ ] Monitor pool exhaustion events

## Secure Configuration Example

```typescript
import { defineConfig } from 'drizzle-multitenant';
import { z } from 'zod';

// Tenant ID schema
const TenantIdSchema = z.string()
  .min(3)
  .max(36)
  .regex(/^[a-z0-9-]+$/, 'Invalid tenant ID');

// Validate tenant ID
export function validateTenantId(id: unknown): string {
  return TenantIdSchema.parse(id);
}

// Secure schema name
function secureSchemaName(id: string): string {
  const validated = validateTenantId(id);
  return `tenant_${validated.replace(/-/g, '_')}`;
}

export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    poolConfig: {
      // Use SSL in production
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: true,
      } : false,
    },
  },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: secureSchemaName,
    maxPools: 50,
  },
  hooks: {
    onPoolCreated: (tenantId) => {
      console.log(`[AUDIT] Pool created for tenant: ${tenantId}`);
    },
    onError: (tenantId, error) => {
      console.error(`[SECURITY] Error for tenant ${tenantId}:`, error);
    },
  },
  schemas: { tenant: tenantSchema },
});
```

## Related Resources

- [PostgreSQL Schema Documentation](https://www.postgresql.org/docs/current/ddl-schemas.html)
- [OWASP Multi-Tenancy Security](https://cheatsheetseries.owasp.org/cheatsheets/Multi-Tenancy_Security_Cheat_Sheet.html)
- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
