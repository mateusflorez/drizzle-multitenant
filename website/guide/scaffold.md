# Scaffolding

## Overview

The scaffold commands generate boilerplate code following best practices. Instead of copy-pasting code, use scaffolding to create consistent, well-structured files.

Available scaffolds:
- **schema** - Drizzle ORM table definitions
- **seed** - Database seed files
- **migration** - SQL migration files with templates

## Schema Scaffolding

### Basic Usage

```bash
# Generate tenant schema
npx drizzle-multitenant scaffold:schema orders --type=tenant

# Generate shared schema
npx drizzle-multitenant scaffold:schema plans --type=shared
```

Output locations:
- Tenant: `src/db/schema/tenant/<name>.ts`
- Shared: `src/db/schema/shared/<name>.ts`

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--type` | Schema type: `tenant` or `shared` | `tenant` |
| `--timestamps` | Include created_at/updated_at | `true` |
| `--soft-delete` | Include deleted_at column | `false` |
| `--uuid` | Use UUID for primary key | `true` |
| `--with-example` | Include example columns | `false` |
| `--with-zod` | Generate Zod validation schemas | `false` |
| `--interactive` | Interactive prompts | `false` |
| `--output` | Custom output path | - |
| `--json` | Output result as JSON | `false` |

### Examples

**Basic schema with timestamps:**

```bash
npx drizzle-multitenant scaffold:schema orders --type=tenant
```

```typescript
// src/db/schema/tenant/orders.ts
import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Schema with soft delete:**

```bash
npx drizzle-multitenant scaffold:schema users --type=tenant --soft-delete
```

```typescript
// src/db/schema/tenant/users.ts
import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});
```

**Schema with example columns:**

```bash
npx drizzle-multitenant scaffold:schema products --type=tenant --with-example
```

```typescript
// src/db/schema/tenant/products.ts
import { pgTable, uuid, text, numeric, timestamp } from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  price: numeric('price', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Schema with Zod validation:**

```bash
npx drizzle-multitenant scaffold:schema orders --type=tenant --with-zod
```

```typescript
// src/db/schema/tenant/orders.ts
import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Zod schemas
export const insertOrderSchema = createInsertSchema(orders);
export const selectOrderSchema = createSelectSchema(orders);

// Types
export type Order = z.infer<typeof selectOrderSchema>;
export type NewOrder = z.infer<typeof insertOrderSchema>;
```

**Serial ID instead of UUID:**

```bash
npx drizzle-multitenant scaffold:schema logs --type=tenant --no-uuid
```

```typescript
// src/db/schema/tenant/logs.ts
import { pgTable, serial, timestamp } from 'drizzle-orm/pg-core';

export const logs = pgTable('logs', {
  id: serial('id').primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### Interactive Mode

```bash
npx drizzle-multitenant scaffold:schema --interactive
```

```
? Schema name: orders
? Schema type: (tenant/shared) tenant
? Include timestamps (created_at, updated_at)? Yes
? Include soft delete (deleted_at)? No
? Primary key type: (uuid/serial) uuid
? Include example columns? Yes
? Generate Zod schemas? Yes

Created: src/db/schema/tenant/orders.ts
```

## Seed Scaffolding

### Basic Usage

```bash
# Generate tenant seed
npx drizzle-multitenant scaffold:seed initial --type=tenant

# Generate shared seed
npx drizzle-multitenant scaffold:seed plans --type=shared
```

Output locations:
- Tenant: `drizzle/seeds/tenant/<name>.ts`
- Shared: `drizzle/seeds/shared/<name>.ts`

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--type` | Seed type: `tenant` or `shared` | `tenant` |
| `--table` | Include import for specific table | - |
| `--output` | Custom output path | - |
| `--json` | Output result as JSON | `false` |

### Examples

**Basic tenant seed:**

```bash
npx drizzle-multitenant scaffold:seed initial --type=tenant
```

```typescript
// drizzle/seeds/tenant/initial.ts
import { SeedFunction } from 'drizzle-multitenant';

export const seed: SeedFunction = async (db, tenantId) => {
  // Add your seed data here
  // Example:
  // await db.insert(users).values([
  //   { name: 'Admin', email: 'admin@example.com' },
  // ]).onConflictDoNothing();

  console.log(`Seeded tenant: ${tenantId}`);
};
```

**Seed with table import:**

```bash
npx drizzle-multitenant scaffold:seed roles --type=tenant --table=roles
```

```typescript
// drizzle/seeds/tenant/roles.ts
import { SeedFunction } from 'drizzle-multitenant';
import { roles } from '../../../src/db/schema/tenant/roles';

export const seed: SeedFunction = async (db, tenantId) => {
  await db.insert(roles).values([
    // Add your seed data here
  ]).onConflictDoNothing();

  console.log(`Seeded roles for tenant: ${tenantId}`);
};
```

**Shared seed:**

```bash
npx drizzle-multitenant scaffold:seed plans --type=shared --table=plans
```

```typescript
// drizzle/seeds/shared/plans.ts
import { SharedSeedFunction } from 'drizzle-multitenant';
import { plans } from '../../../src/db/schema/shared/plans';

export const seed: SharedSeedFunction = async (db) => {
  await db.insert(plans).values([
    // Add your seed data here
  ]).onConflictDoNothing();

  console.log('Seeded shared plans');
};
```

## Migration Scaffolding

### Basic Usage

```bash
# Generate tenant migration
npx drizzle-multitenant scaffold:migration add-orders --type=tenant

# Generate shared migration
npx drizzle-multitenant scaffold:migration add-plans --type=shared
```

Output locations:
- Tenant: `drizzle/tenant-migrations/<sequence>_<name>.sql`
- Shared: `drizzle/shared-migrations/<sequence>_<name>.sql`

### Templates

| Template | Description |
|----------|-------------|
| `create-table` | CREATE TABLE boilerplate |
| `add-column` | ALTER TABLE ADD COLUMN |
| `add-index` | CREATE INDEX |
| `add-foreign-key` | ALTER TABLE ADD CONSTRAINT |
| `blank` | Empty migration file |

The template is auto-detected from the migration name:
- Names starting with `create-` use `create-table`
- Names starting with `add-` use `add-column`
- Otherwise `blank` is used

### Examples

**Create table migration:**

```bash
npx drizzle-multitenant scaffold:migration create-orders --type=tenant
```

```sql
-- drizzle/tenant-migrations/0001_create-orders.sql
-- Migration: create-orders
-- Created at: 2024-01-15T10:30:00.000Z

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Add your columns here
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
-- CREATE INDEX idx_orders_<column> ON orders (<column>);
```

**Add column migration:**

```bash
npx drizzle-multitenant scaffold:migration add-avatar-url --type=tenant
```

```sql
-- drizzle/tenant-migrations/0002_add-avatar-url.sql
-- Migration: add-avatar-url
-- Created at: 2024-01-15T10:35:00.000Z

ALTER TABLE <table_name>
ADD COLUMN IF NOT EXISTS <column_name> <data_type>;

-- Example:
-- ALTER TABLE users
-- ADD COLUMN IF NOT EXISTS avatar_url TEXT;
```

**Add index migration:**

```bash
npx drizzle-multitenant scaffold:migration add-email-index --type=tenant --template=add-index
```

```sql
-- drizzle/tenant-migrations/0003_add-email-index.sql
-- Migration: add-email-index
-- Created at: 2024-01-15T10:40:00.000Z

CREATE INDEX IF NOT EXISTS idx_<table>_<column>
ON <table_name> (<column_name>);

-- Example:
-- CREATE INDEX IF NOT EXISTS idx_users_email
-- ON users (email);

-- For composite indexes:
-- CREATE INDEX IF NOT EXISTS idx_users_tenant_email
-- ON users (tenant_id, email);
```

**Add foreign key migration:**

```bash
npx drizzle-multitenant scaffold:migration add-order-user-fk --type=tenant --template=add-foreign-key
```

```sql
-- drizzle/tenant-migrations/0004_add-order-user-fk.sql
-- Migration: add-order-user-fk
-- Created at: 2024-01-15T10:45:00.000Z

ALTER TABLE <child_table>
ADD CONSTRAINT fk_<child_table>_<parent_table>
FOREIGN KEY (<column_name>)
REFERENCES <parent_table> (<parent_column>)
ON DELETE CASCADE;

-- Example:
-- ALTER TABLE orders
-- ADD CONSTRAINT fk_orders_users
-- FOREIGN KEY (user_id)
-- REFERENCES users (id)
-- ON DELETE CASCADE;
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--type` | Migration type: `tenant` or `shared` | `tenant` |
| `--template` | Template to use | auto-detect |
| `--output` | Custom output path | - |
| `--json` | Output result as JSON | `false` |

## Programmatic API

```typescript
import {
  generateSchemaTemplate,
  generateSeedTemplate,
  generateMigrationTemplate,
} from 'drizzle-multitenant/scaffold';

// Generate schema
const schema = generateSchemaTemplate('orders', {
  type: 'tenant',
  timestamps: true,
  softDelete: false,
  uuid: true,
  withZod: true,
});
console.log(schema.content);

// Generate seed
const seed = generateSeedTemplate('initial', {
  type: 'tenant',
  table: 'users',
});
console.log(seed.content);

// Generate migration
const migration = generateMigrationTemplate('create-orders', {
  type: 'tenant',
  template: 'create-table',
  sequence: 1,
});
console.log(migration.content);
```

## Best Practices

1. **Use interactive mode for complex schemas**: The wizard helps configure options correctly
2. **Always review generated code**: Templates are starting points, customize as needed
3. **Keep migrations atomic**: One logical change per migration file
4. **Use meaningful names**: `create-users`, `add-avatar-url`, `add-email-index`
5. **Follow naming conventions**: snake_case for tables and columns

## See Also

- [Schema Linting](/guide/schema-linting) - Validate generated schemas
- [Shared Schema](/guide/shared-schema) - Managing shared schemas
- [CLI Commands](/guide/cli) - Full CLI reference
