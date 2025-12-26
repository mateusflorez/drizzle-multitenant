# Shared Schema Management

## Overview

Multi-tenant applications often need tables shared across all tenants, such as plans, roles, permissions, and configuration. The shared schema (typically `public` in PostgreSQL) holds this data.

**drizzle-multitenant** provides complete support for:
- Shared schema migrations
- Shared schema seeding
- Unified migration orchestration (shared + tenants)

## Folder Structure

```
drizzle/
├── tenant-migrations/        # Per-tenant migrations
│   ├── 0001_create_users.sql
│   └── 0002_add_profiles.sql
├── shared-migrations/        # Shared schema migrations
│   ├── 0001_create_plans.sql
│   └── 0002_create_roles.sql
└── seeds/
    ├── tenant/
    │   └── initial.ts
    └── shared/
        └── plans.ts
```

## Configuration

### Auto-Detection from drizzle.config.ts

If you already have a `drizzle.config.ts` for drizzle-kit, **drizzle-multitenant** will automatically detect and use its settings for shared schema migrations:

```typescript
// drizzle.config.ts (your existing drizzle-kit config)
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',                    // ← Auto-detected as sharedFolder
  schema: './src/db/schema/shared.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    table: '__drizzle_migrations',     // ← Auto-detected as sharedTable
    schema: 'public',
  },
});
```

```typescript
// tenant.config.ts (simplified - no shared config needed!)
import { defineConfig } from 'drizzle-multitenant';
import * as tenantSchema from './src/db/schema/tenant';
import * as sharedSchema from './src/db/schema/shared';

export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
  },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (id) => `tenant_${id}`,
  },
  schemas: {
    tenant: tenantSchema,
    shared: sharedSchema,
  },
  migrations: {
    tenantFolder: './drizzle/tenant',
    tenantDiscovery: async () => getTenantIds(),
    // No shared config needed - auto-detected from drizzle.config.ts!
  },
});
```

When starting the interactive menu, you'll see the detection:

```
✔ Configuration loaded
  └─ Shared schema: ./drizzle (from drizzle.config.ts)
```

### Manual Configuration

If you prefer explicit configuration or need to override drizzle.config.ts settings:

```typescript
// tenant.config.ts
import { defineConfig } from 'drizzle-multitenant';
import * as tenantSchema from './src/db/schema/tenant';
import * as sharedSchema from './src/db/schema/shared';

export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
  },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (id) => `tenant_${id}`,
  },
  schemas: {
    tenant: tenantSchema,
    shared: sharedSchema,
  },
  migrations: {
    tenantFolder: './drizzle/tenant-migrations',
    sharedFolder: './drizzle/shared-migrations',  // Explicit shared folder
    table: '__drizzle_migrations',
    sharedTable: '__drizzle_shared_migrations',   // Separate tracking table
    sharedTableFormat: 'auto',                    // Auto-detect format
    sharedDefaultFormat: 'name',                  // Default when creating new table
    tenantDiscovery: async () => getTenantIds(),
  },
});
```

### Configuration Priority

Settings are resolved in this order:

1. **tenant.config.ts** (explicit configuration)
2. **drizzle.config.ts** (auto-detected)
3. **Defaults**

| Setting | tenant.config.ts | drizzle.config.ts | Default |
|---------|-----------------|-------------------|---------|
| Shared folder | `sharedFolder` | `out` | - |
| Shared table | `sharedTable` | `migrations.table` | `__drizzle_migrations` |
| Table format | `sharedTableFormat` | - | `'auto'` |

## Shared Migrations

### Generate a Shared Migration

```bash
npx drizzle-multitenant generate:shared --name=add-plans
```

Creates: `drizzle/shared-migrations/0001_add-plans.sql`

### Apply Shared Migrations

```bash
# Apply to shared schema only
npx drizzle-multitenant migrate:shared

# Dry-run to preview
npx drizzle-multitenant migrate:shared --dry-run

# Mark as applied without executing
npx drizzle-multitenant migrate:shared --mark-applied
```

### Migration Order

For new deployments, always migrate shared schema first:

```bash
# 1. Shared schema (plans, roles, permissions)
npx drizzle-multitenant migrate:shared

# 2. All tenant schemas
npx drizzle-multitenant migrate --all --concurrency=10
```

## Shared Seeding

### Create a Shared Seed File

```typescript
// seeds/shared/plans.ts
import { SharedSeedFunction } from 'drizzle-multitenant';
import { plans, roles, permissions } from '../src/db/schema/shared';

export const seed: SharedSeedFunction = async (db) => {
  // Insert plans
  await db.insert(plans).values([
    { id: 'free', name: 'Free', price: 0, maxUsers: 5 },
    { id: 'pro', name: 'Pro', price: 29, maxUsers: 50 },
    { id: 'enterprise', name: 'Enterprise', price: 99, maxUsers: null },
  ]).onConflictDoNothing();

  // Insert roles
  await db.insert(roles).values([
    { id: 'admin', name: 'Administrator' },
    { id: 'user', name: 'User' },
    { id: 'viewer', name: 'Viewer' },
  ]).onConflictDoNothing();

  // Insert permissions
  await db.insert(permissions).values([
    { id: 'read', name: 'Read', description: 'Read access' },
    { id: 'write', name: 'Write', description: 'Write access' },
    { id: 'delete', name: 'Delete', description: 'Delete access' },
    { id: 'admin', name: 'Admin', description: 'Full access' },
  ]).onConflictDoNothing();
};
```

### Apply Shared Seeds

```bash
npx drizzle-multitenant seed:shared --file=./seeds/shared/plans.ts
```

## Unified Seeding

Seed shared schema first, then all tenants in one command:

```bash
npx drizzle-multitenant seed:all \
  --shared-file=./seeds/shared/plans.ts \
  --tenant-file=./seeds/tenant/initial.ts \
  --concurrency=5
```

This ensures:
1. Shared data exists before tenant seeds run
2. Tenant seeds can reference shared data (plans, roles)

## Programmatic API

### Migrator Integration

```typescript
import { createMigrator } from 'drizzle-multitenant/migrator';
import config from './tenant.config';

const migrator = createMigrator(config, {
  migrationsFolder: './drizzle/tenant-migrations',
  sharedMigrationsFolder: './drizzle/shared-migrations',
});

// Migrate shared schema
await migrator.migrateShared();

// Migrate all tenants
await migrator.migrateAll({ concurrency: 10 });

// Or migrate shared + tenants in sequence
await migrator.migrateAllWithShared({ concurrency: 10 });

// Get shared migration status
const sharedStatus = await migrator.getSharedStatus();
console.log(`Applied: ${sharedStatus.applied}, Pending: ${sharedStatus.pending}`);
```

### Seeding Integration

```typescript
import { createMigrator } from 'drizzle-multitenant/migrator';
import { sharedSeed } from './seeds/shared/plans';
import { tenantSeed } from './seeds/tenant/initial';

const migrator = createMigrator(config, migratorConfig);

// Seed shared schema
await migrator.seedShared(sharedSeed);

// Seed all tenants
await migrator.seedAll(tenantSeed, { concurrency: 5 });

// Or seed shared + tenants in sequence
await migrator.seedAllWithShared(sharedSeed, tenantSeed, {
  concurrency: 5,
});
```

### Checking Status

```typescript
// Check if shared seeding is configured
const hasSharedSeeding = migrator.hasSharedSeeding();

// Check shared migration status
const sharedStatus = await migrator.getSharedStatus();
// {
//   applied: 3,
//   pending: 1,
//   migrations: [
//     { name: '0001_create_plans.sql', appliedAt: '2024-01-15T10:30:00Z' },
//     { name: '0002_create_roles.sql', appliedAt: '2024-01-15T10:30:05Z' },
//     ...
//   ]
// }
```

## Example Shared Schemas

### Plans Table

```typescript
// src/db/schema/shared/plans.ts
import { pgTable, text, integer, boolean } from 'drizzle-orm/pg-core';

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  price: integer('price').notNull().default(0),
  maxUsers: integer('max_users'),
  maxStorage: integer('max_storage'),
  features: text('features').array(),
  isActive: boolean('is_active').notNull().default(true),
});
```

### Roles and Permissions

```typescript
// src/db/schema/shared/roles.ts
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: text('role_id').references(() => roles.id).notNull(),
  permissionId: text('permission_id').references(() => permissions.id).notNull(),
});
```

## Interactive Menu

The interactive menu includes shared schema management:

```bash
npx drizzle-multitenant
```

```
? drizzle-multitenant - Main Menu
❯ Migration Status (5 ok, 2 pending)
  Migrate Tenants (3 pending)
  Shared Migrations           ← Manage shared migrations
  ──────────────
  Create Tenant
  Drop Tenant
  ──────────────
  Seed Tenants
  Seed Shared                 ← Seed shared schema
  ──────────────
  Generate Migration
  Refresh
  Exit
```

## Deployment Workflow

Recommended order for production deployments:

```bash
# 1. Apply shared migrations first
npx drizzle-multitenant migrate:shared

# 2. Seed shared data if needed
npx drizzle-multitenant seed:shared --file=./seeds/shared/plans.ts

# 3. Apply tenant migrations
npx drizzle-multitenant migrate --all --concurrency=10

# 4. Seed tenant data if needed
npx drizzle-multitenant seed --all --file=./seeds/tenant/initial.ts
```

Or use unified commands:

```bash
# Migrate shared + tenants
npx drizzle-multitenant migrate:shared && npx drizzle-multitenant migrate --all

# Seed shared + tenants
npx drizzle-multitenant seed:all \
  --shared-file=./seeds/shared/plans.ts \
  --tenant-file=./seeds/tenant/initial.ts
```

## Best Practices

1. **Always migrate shared first**: Tenant schemas may reference shared tables
2. **Use `onConflictDoNothing()`**: Makes seeds idempotent for reruns
3. **Separate concerns**: Keep shared schemas focused (plans, roles, config)
4. **Version shared data carefully**: Changes affect all tenants immediately
5. **Use transactions in seeds**: Ensure atomic operations

## See Also

- [Cross-Schema Queries](/guide/cross-schema) - Query across shared and tenant schemas
- [CLI Commands](/guide/cli) - Full CLI reference
- [Configuration](/guide/configuration) - All configuration options
