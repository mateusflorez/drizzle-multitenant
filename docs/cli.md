# CLI Commands

## Overview

```bash
# Initialize configuration
npx drizzle-multitenant init

# Generate migration
npx drizzle-multitenant generate --name=add-users-table

# Apply migrations
npx drizzle-multitenant migrate --all --concurrency=10

# Check status
npx drizzle-multitenant status

# Tenant management
npx drizzle-multitenant tenant:create --id=new-tenant
npx drizzle-multitenant tenant:drop --id=old-tenant --force
```

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
