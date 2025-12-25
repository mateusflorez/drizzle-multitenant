# CLI Commands

## Overview

```bash
# Interactive menu (recommended)
npx drizzle-multitenant

# Initialize configuration (enhanced wizard)
npx drizzle-multitenant init --template=full

# Generate migration (tenant or shared)
npx drizzle-multitenant generate --name=add-users-table
npx drizzle-multitenant generate:shared --name=add-plans

# Apply migrations
npx drizzle-multitenant migrate --all --concurrency=10
npx drizzle-multitenant migrate:shared

# Check status
npx drizzle-multitenant status

# Schema drift detection
npx drizzle-multitenant diff

# Tenant management
npx drizzle-multitenant tenant:create --id=new-tenant
npx drizzle-multitenant tenant:drop --id=old-tenant --force
npx drizzle-multitenant tenant:clone --from=prod --to=dev

# Seed data (tenant or shared)
npx drizzle-multitenant seed --all --file=./seeds/initial.ts
npx drizzle-multitenant seed:shared --file=./seeds/shared/plans.ts
npx drizzle-multitenant seed:all --shared-file=./seeds/shared/plans.ts --tenant-file=./seeds/tenant/initial.ts

# Scaffolding
npx drizzle-multitenant scaffold:schema orders --type=tenant
npx drizzle-multitenant scaffold:seed initial --type=tenant
npx drizzle-multitenant scaffold:migration add-orders --type=tenant

# Schema linting
npx drizzle-multitenant lint

# Diagnostics
npx drizzle-multitenant doctor

# Export/Import schemas
npx drizzle-multitenant export --format=typescript
npx drizzle-multitenant import schemas.json -o ./src/db/schema

# Metrics
npx drizzle-multitenant metrics --prometheus
```

## Interactive Menu

Run without arguments to launch the interactive menu:

```bash
npx drizzle-multitenant
```

```
? drizzle-multitenant - Main Menu (Use arrow keys)
❯ Migration Status (5 ok, 2 pending)
  Migrate Tenants (3 pending)
  Shared Migrations
  ──────────────
  Create Tenant
  Drop Tenant
  Clone Tenant
  ──────────────
  Seed Tenants
  Seed Shared
  Schema Diff
  ──────────────
  Generate Migration
  Schema Lint
  Metrics
  ──────────────
  Refresh
  Exit
```

The menu provides:
- Real-time migration status overview
- Multi-select tenant operations
- Shared schema management
- Schema linting and validation
- Metrics visualization
- Progress tracking with live updates
- Keyboard navigation

## Global Options

```bash
--json       # Output as JSON (for scripts/CI)
--verbose    # Show detailed output
--quiet      # Only show errors
--no-color   # Disable colored output
```

## Commands

### init

Enhanced interactive wizard to create configuration and project structure.

```bash
# Basic config-only setup
npx drizzle-multitenant init

# Full project structure with examples
npx drizzle-multitenant init --template=full
```

**Available Templates:**

| Template | Description |
|----------|-------------|
| `minimal` | Config file only |
| `standard` | Config + folder structure |
| `full` | Config + folders + example schemas + seeds |
| `enterprise` | Full + CI/CD + Docker |

**Wizard Steps:**

```
🚀 drizzle-multitenant Setup Wizard

? Project template:
  ❯ Minimal (config only)
    Standard (config + folder structure)
    Full (config + folders + example schemas)
    Enterprise (full + CI/CD + Docker)

? Framework integration:
  ❯ None (standalone)
    Express
    Fastify
    NestJS
    Hono

? Features to include:
  ☑ Shared schema support
  ☑ Cross-schema queries
  ☑ Health check endpoints
  ☐ Metrics (Prometheus)
  ☐ Debug mode

? Database setup:
  ❯ I'll configure manually
    Generate docker-compose.yml
    Use existing DATABASE_URL
```

**Generated Structure (full template):**

```
project/
├── tenant.config.ts
├── docker-compose.yml
├── drizzle/
│   ├── tenant-migrations/
│   ├── shared-migrations/
│   └── seeds/
│       ├── tenant/initial.ts
│       └── shared/plans.ts
├── src/db/
│   ├── schema/
│   │   ├── tenant/users.ts
│   │   └── shared/plans.ts
│   └── index.ts
└── .env.example
```

### generate

Generate a new migration file.

```bash
npx drizzle-multitenant generate --name=add-users-table
```

### migrate

Apply migrations to tenants.

```bash
# All tenants with progress bar
npx drizzle-multitenant migrate --all --concurrency=10

# Interactive selection
npx drizzle-multitenant migrate

# Mark as applied without executing SQL
npx drizzle-multitenant migrate --all --mark-applied
```

### status

Check migration status across tenants.

```bash
npx drizzle-multitenant status
npx drizzle-multitenant status --json
```

Output:
```
┌──────────────────┬──────────────┬────────────┬─────────┬─────────┬──────────┐
│ Tenant           │ Schema       │ Format     │ Applied │ Pending │ Status   │
├──────────────────┼──────────────┼────────────┼─────────┼─────────┼──────────┤
│ abc-123          │ tenant_abc   │ drizzle-kit│ 45      │ 3       │ Behind   │
│ def-456          │ tenant_def   │ name       │ 48      │ 0       │ OK       │
└──────────────────┴──────────────┴────────────┴─────────┴─────────┴──────────┘
```

### sync

Detect and fix divergences between disk and database.

```bash
# Show sync status
npx drizzle-multitenant sync --status

# Mark missing migrations as applied
npx drizzle-multitenant sync --mark-missing

# Remove orphan records
npx drizzle-multitenant sync --clean-orphans

# Fix all divergences
npx drizzle-multitenant sync --mark-missing --clean-orphans
```

| Scenario | Solution |
|----------|----------|
| Migration file renamed | `--clean-orphans` |
| Migration file deleted | `--clean-orphans` |
| Migrations applied manually | `--mark-missing` |
| Legacy project onboarding | `migrate --mark-applied` |

### tenant:create

Create a new tenant schema.

```bash
npx drizzle-multitenant tenant:create --id=new-tenant
```

### tenant:drop

Drop a tenant schema.

```bash
npx drizzle-multitenant tenant:drop --id=old-tenant --force
```

### tenant:clone

Clone a tenant schema with optional data copying and anonymization.

```bash
# Clone schema only
npx drizzle-multitenant tenant:clone --from=production --to=staging

# Clone with data
npx drizzle-multitenant tenant:clone --from=production --to=dev --include-data

# Clone with data anonymization (GDPR compliance)
npx drizzle-multitenant tenant:clone --from=production --to=dev --include-data --anonymize
```

Options:
- `--from` - Source tenant ID
- `--to` - Target tenant ID
- `--include-data` - Copy all table data
- `--anonymize` - Anonymize sensitive columns (requires config)

### seed

Apply seed data to tenants.

```bash
# Seed single tenant
npx drizzle-multitenant seed --tenant=abc --file=./seeds/initial.ts

# Seed all tenants
npx drizzle-multitenant seed --all --file=./seeds/initial.ts

# Seed specific tenants
npx drizzle-multitenant seed --tenants=tenant-1,tenant-2 --file=./seeds/initial.ts

# With concurrency control
npx drizzle-multitenant seed --all --file=./seeds/initial.ts --concurrency=5
```

Seed file format:

```typescript
// seeds/initial.ts
import { SeedFunction } from 'drizzle-multitenant';

export const seed: SeedFunction = async (db, tenantId) => {
  await db.insert(roles).values([
    { name: 'admin', permissions: ['*'] },
    { name: 'user', permissions: ['read'] },
  ]);

  await db.insert(settings).values({
    tenantId,
    theme: 'light',
    language: 'pt-BR',
  });
};
```

### diff

Detect schema drift between tenants.

```bash
# Compare all tenants against first tenant
npx drizzle-multitenant diff

# Use specific tenant as reference
npx drizzle-multitenant diff --reference=production-tenant

# Compare single tenant against reference
npx drizzle-multitenant diff --tenant=staging --reference=production

# Skip index/constraint comparison
npx drizzle-multitenant diff --no-indexes --no-constraints

# JSON output for CI/CD
npx drizzle-multitenant diff --json
```

Output:
```
Schema Drift Status:
  tenant-1: (ref) No drift
  tenant-2: 3 issues detected
  tenant-3: No drift

Summary:
  Total:      3
  No Drift:   2
  With Drift: 1
  Duration:   245ms

Drift Details:

  tenant-2 (tenant_tenant-2):
    ~ Table "users":
      ✗ Column "avatar_url" (varchar) is missing
      ✗ Column "last_login" (timestamp) is missing
      + Extra column "legacy_field" (varchar) not in reference
```

### convert-format

Convert migration table format.

```bash
# Preview conversion
npx drizzle-multitenant convert-format --to=name --dry-run

# Convert all tenants
npx drizzle-multitenant convert-format --to=name

# Convert specific tenant
npx drizzle-multitenant convert-format --to=name --tenant=abc-123
```

### completion

Generate shell completions.

```bash
npx drizzle-multitenant completion bash >> ~/.bashrc
npx drizzle-multitenant completion zsh >> ~/.zshrc
npx drizzle-multitenant completion fish >> ~/.config/fish/completions/drizzle-multitenant.fish
npx drizzle-multitenant completion powershell >> $PROFILE
```

### generate:shared

Generate a migration file for the shared (public) schema.

```bash
npx drizzle-multitenant generate:shared --name=add-plans
```

This creates a migration in `drizzle/shared-migrations/` instead of `drizzle/tenant-migrations/`.

### migrate:shared

Apply migrations to the shared schema.

```bash
npx drizzle-multitenant migrate:shared
```

Options:
- `--dry-run` - Preview without executing
- `--mark-applied` - Mark as applied without executing SQL

### seed:shared

Apply seed data to the shared schema.

```bash
npx drizzle-multitenant seed:shared --file=./seeds/shared/plans.ts
```

Shared seed file format:

```typescript
// seeds/shared/plans.ts
import { SharedSeedFunction } from 'drizzle-multitenant';

export const seed: SharedSeedFunction = async (db) => {
  await db.insert(plans).values([
    { id: 'free', name: 'Free', price: 0 },
    { id: 'pro', name: 'Pro', price: 29 },
    { id: 'enterprise', name: 'Enterprise', price: 99 },
  ]).onConflictDoNothing();
};
```

### seed:all

Apply seed data to shared schema first, then all tenants.

```bash
npx drizzle-multitenant seed:all \
  --shared-file=./seeds/shared/plans.ts \
  --tenant-file=./seeds/tenant/initial.ts \
  --concurrency=5
```

### scaffold:schema

Generate a new Drizzle schema file with best practices.

```bash
# Generate tenant schema
npx drizzle-multitenant scaffold:schema orders --type=tenant

# Generate shared schema
npx drizzle-multitenant scaffold:schema plans --type=shared

# Interactive mode
npx drizzle-multitenant scaffold:schema --interactive
```

Options:
- `--type` - `tenant` or `shared`
- `--timestamps` - Include created_at/updated_at (default: true)
- `--soft-delete` - Include deleted_at column
- `--uuid` - Use UUID for primary key (default: true)
- `--with-example` - Include example columns
- `--with-zod` - Generate Zod schemas
- `--interactive` - Interactive mode with prompts

Generated file example:

```typescript
// src/db/schema/tenant/orders.ts
import { pgTable, uuid, text, timestamp, numeric } from 'drizzle-orm/pg-core';
import { users } from './users';

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  status: text('status').notNull().default('pending'),
  total: numeric('total', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### scaffold:seed

Generate a seed file template.

```bash
# Generate tenant seed
npx drizzle-multitenant scaffold:seed initial --type=tenant

# Generate shared seed
npx drizzle-multitenant scaffold:seed plans --type=shared
```

### scaffold:migration

Generate a migration file with template.

```bash
# Create table migration
npx drizzle-multitenant scaffold:migration create-orders --type=tenant --template=create-table

# Add column migration
npx drizzle-multitenant scaffold:migration add-avatar --type=tenant --template=add-column

# Blank migration
npx drizzle-multitenant scaffold:migration custom-changes --type=tenant --template=blank
```

Templates available:
- `create-table` - CREATE TABLE boilerplate
- `add-column` - ALTER TABLE ADD COLUMN
- `add-index` - CREATE INDEX
- `add-foreign-key` - ALTER TABLE ADD CONSTRAINT
- `blank` - Empty migration file

### lint

Validate schemas against configurable rules.

```bash
npx drizzle-multitenant lint
```

Options:
- `--tenant-schema` - Tenant schema directory
- `--shared-schema` - Shared schema directory
- `--format` - Output format: `console`, `json`, `github`
- `--rule` - Enable specific rules
- `--ignore-rule` - Disable specific rules

Output example:

```
Schema Validation Results

  ⚠ tenant/users.ts
    Line 12: [require-timestamps] Missing 'updatedAt' column

  ⚠ tenant/orders.ts
    Line 8: [index-foreign-keys] Missing index on foreign key 'userId'

  ✗ shared/plans.ts
    Line 5: [prefer-uuid-pk] Using 'serial' instead of 'uuid' for primary key

Summary: 12 schemas validated, 2 warnings, 1 error
```

Available rules:

| Rule | Severity | Description |
|------|----------|-------------|
| `table-naming` | error | Table names must be snake_case |
| `column-naming` | error | Column names must be snake_case |
| `require-primary-key` | error | All tables must have a primary key |
| `prefer-uuid-pk` | warn | Prefer UUID over serial for PKs |
| `require-timestamps` | warn | Tables should have created_at/updated_at |
| `index-foreign-keys` | warn | Foreign keys should have indexes |
| `no-cascade-delete` | warn | Avoid CASCADE DELETE |
| `require-soft-delete` | off | Tables should have deleted_at |

Configure rules in `tenant.config.ts`:

```typescript
export default defineConfig({
  lint: {
    rules: {
      'table-naming': ['error', { style: 'snake_case' }],
      'prefer-uuid-pk': 'warn',
      'require-soft-delete': 'off',
    },
  },
});
```

CI/CD integration:

```yaml
- name: Lint schemas
  run: npx drizzle-multitenant lint --format=github
```

### doctor

Diagnose configuration and connection issues.

```bash
npx drizzle-multitenant doctor
```

Output:

```
🔍 Checking drizzle-multitenant configuration...

✓ Configuration file found: tenant.config.ts
✓ Database connection: OK (PostgreSQL 15.4)
✓ Tenant discovery: Found 42 tenants
✓ Migrations folder: ./drizzle/tenant-migrations (12 files)
✓ Shared migrations folder: ./drizzle/shared-migrations (3 files)
✓ Schema isolation: schema-based
✓ Pool configuration: max=50, ttl=3600000ms

⚠ Recommendations:
  1. Consider increasing maxPools (current: 50, tenants: 42)
  2. Enable metrics collection for production monitoring

📊 Health Summary:
  Pools: 5 active, 0 degraded, 0 unhealthy
  Shared DB: OK (12ms latency)
```

Options:
- `--json` - Output as JSON for scripting

### export

Export schemas to various formats.

```bash
# Export as JSON Schema
npx drizzle-multitenant export --format=json > schemas.json

# Export as TypeScript types
npx drizzle-multitenant export --format=typescript > schemas.d.ts

# Export as Mermaid ERD
npx drizzle-multitenant export --format=mermaid > erd.md

# Include Zod schemas in TypeScript export
npx drizzle-multitenant export --format=typescript --include-zod
```

Options:
- `--format` - `json`, `typescript`, `mermaid`
- `--output` - Output file path
- `--include-metadata` - Include metadata in JSON
- `--include-zod` - Include Zod schemas in TypeScript
- `--json-schema` - Use JSON Schema format

See [Export & Import](/guide/export-import) for detailed documentation.

### import

Import schemas from JSON to generate Drizzle schema files.

```bash
npx drizzle-multitenant import schemas.json -o ./src/db/schema

# Preview without writing files
npx drizzle-multitenant import schemas.json -o ./src/db/schema --dry-run

# Overwrite existing files
npx drizzle-multitenant import schemas.json -o ./src/db/schema --overwrite
```

Options:
- `--output` - Output directory
- `--overwrite` - Overwrite existing files
- `--include-zod` - Generate Zod schemas
- `--dry-run` - Preview without writing

### metrics

View pool and health metrics.

```bash
# Console output
npx drizzle-multitenant metrics

# Prometheus format
npx drizzle-multitenant metrics --prometheus

# Watch mode
npx drizzle-multitenant metrics --watch --interval=5000

# Include health check (may be slow)
npx drizzle-multitenant metrics --health
```

Options:
- `--prometheus` - Output in Prometheus text format
- `--health` - Include health check data
- `--watch` - Continuous monitoring
- `--interval` - Refresh interval in ms (default: 10000)

See [Advanced - Metrics](/guide/advanced#metrics) for integration guides.

## JSON Output

```bash
# Parse results in scripts
npx drizzle-multitenant status --json | jq '.tenants[] | select(.pending > 0)'
npx drizzle-multitenant migrate --all --json | jq '.summary'
```
