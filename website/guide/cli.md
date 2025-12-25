# CLI Commands

## Overview

```bash
# Interactive menu (recommended)
npx drizzle-multitenant

# Initialize configuration
npx drizzle-multitenant init

# Generate migration
npx drizzle-multitenant generate --name=add-users-table

# Apply migrations
npx drizzle-multitenant migrate --all --concurrency=10

# Check status
npx drizzle-multitenant status

# Schema drift detection
npx drizzle-multitenant diff

# Tenant management
npx drizzle-multitenant tenant:create --id=new-tenant
npx drizzle-multitenant tenant:drop --id=old-tenant --force
npx drizzle-multitenant tenant:clone --from=prod --to=dev

# Seed data
npx drizzle-multitenant seed --all --file=./seeds/initial.ts
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
  ──────────────
  Create Tenant
  Drop Tenant
  Clone Tenant
  ──────────────
  Seed Tenants
  Schema Diff
  ──────────────
  Generate Migration
  Refresh
  Exit
```

The menu provides:
- Real-time migration status overview
- Multi-select tenant operations
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

Interactive wizard to create configuration file.

```bash
npx drizzle-multitenant init
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

## JSON Output

```bash
# Parse results in scripts
npx drizzle-multitenant status --json | jq '.tenants[] | select(.pending > 0)'
npx drizzle-multitenant migrate --all --json | jq '.summary'
```
