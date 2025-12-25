# Migration Table Formats

`drizzle-multitenant` supports multiple migration table formats for compatibility with existing databases.

## Supported Formats

| Format | Identifier | Timestamp | Compatible With |
|--------|------------|-----------|-----------------|
| `name` | Filename | `applied_at` (timestamp) | drizzle-multitenant native |
| `hash` | SHA-256 | `created_at` (timestamp) | Custom scripts |
| `drizzle-kit` | SHA-256 | `created_at` (bigint) | drizzle-kit migrate |

## Configuration

```typescript
export default defineConfig({
  migrations: {
    tenantFolder: './drizzle/tenant',
    tenantDiscovery: async () => getTenantIds(),

    /**
     * Table format for tracking migrations
     * - "auto": Auto-detect existing format (default)
     * - "name": Filename-based (drizzle-multitenant native)
     * - "hash": SHA-256 hash
     * - "drizzle-kit": Exact drizzle-kit format
     */
    tableFormat: 'auto',

    /**
     * Format to use when creating new tables (only for "auto" mode)
     */
    defaultFormat: 'name',
  },
});
```

## Auto-Detection

When `tableFormat: 'auto'`, the CLI automatically detects the existing format:

```bash
npx drizzle-multitenant status
```

Output shows detected format per tenant:
```
┌──────────────────┬──────────────┬────────────┬─────────┬─────────┐
│ Tenant           │ Schema       │ Format     │ Applied │ Pending │
├──────────────────┼──────────────┼────────────┼─────────┼─────────┤
│ abc-123          │ tenant_abc   │ drizzle-kit│ 45      │ 3       │
│ def-456          │ tenant_def   │ name       │ 48      │ 0       │
│ ghi-789          │ tenant_ghi   │ (new)      │ 0       │ 48      │
└──────────────────┴──────────────┴────────────┴─────────┴─────────┘
```

## Migrating from drizzle-kit

If you have existing databases with migrations applied via `drizzle-kit migrate`:

```bash
# Check current format
npx drizzle-multitenant status

# Apply new migrations (works with any format)
npx drizzle-multitenant migrate --all
```

## Converting Formats

Standardize all tenants to a single format:

```bash
# Preview conversion
npx drizzle-multitenant convert-format --to=name --dry-run

# Convert all tenants
npx drizzle-multitenant convert-format --to=name

# Convert specific tenant
npx drizzle-multitenant convert-format --to=name --tenant=abc-123

# Convert to drizzle-kit format
npx drizzle-multitenant convert-format --to=drizzle-kit
```

## Table Structures

### name format
```sql
CREATE TABLE __drizzle_migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMP DEFAULT NOW()
);
```

### hash format
```sql
CREATE TABLE __drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### drizzle-kit format
```sql
CREATE TABLE __drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash VARCHAR(64) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL
);
```
