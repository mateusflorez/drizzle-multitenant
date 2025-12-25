# Schema Linting

## Overview

Schema linting validates your Drizzle schemas against configurable rules, helping enforce naming conventions, best practices, and security standards across your codebase.

Use cases:
- Enforce snake_case naming conventions
- Ensure all tables have primary keys
- Require timestamp columns
- Detect missing indexes on foreign keys
- Catch security anti-patterns (CASCADE DELETE)

## Quick Start

```bash
# Lint all schemas
npx drizzle-multitenant lint

# Lint with specific format
npx drizzle-multitenant lint --format=console

# JSON output for scripting
npx drizzle-multitenant lint --format=json

# GitHub Actions format
npx drizzle-multitenant lint --format=github
```

## Configuration

Configure lint rules in your `tenant.config.ts`:

```typescript
import { defineConfig } from 'drizzle-multitenant';

export default defineConfig({
  // ... other config

  lint: {
    rules: {
      // Naming conventions
      'table-naming': ['error', { style: 'snake_case' }],
      'column-naming': ['error', { style: 'snake_case' }],

      // Best practices
      'require-primary-key': 'error',
      'prefer-uuid-pk': 'warn',
      'require-timestamps': 'warn',
      'index-foreign-keys': 'warn',

      // Security
      'no-cascade-delete': 'warn',
      'require-soft-delete': 'off',
    },
  },
});
```

### Rule Severity Levels

| Level | Description |
|-------|-------------|
| `error` | Fails the lint check, exits with code 1 |
| `warn` | Shows warning but passes |
| `off` | Rule disabled |

## Available Rules

### Naming Rules

#### table-naming

Validates table names follow a naming convention.

```typescript
'table-naming': ['error', { style: 'snake_case' }]
```

Options:
- `style`: `snake_case`, `camelCase`, `PascalCase`

Examples:
```typescript
// snake_case (valid)
pgTable('user_profiles', { ... })

// Invalid
pgTable('userProfiles', { ... })  // camelCase not allowed
pgTable('UserProfiles', { ... })  // PascalCase not allowed
```

#### column-naming

Validates column names follow a naming convention.

```typescript
'column-naming': ['error', { style: 'snake_case' }]
```

Options:
- `style`: `snake_case`, `camelCase`

Examples:
```typescript
// snake_case (valid)
{ created_at: timestamp('created_at') }

// Invalid
{ createdAt: timestamp('createdAt') }
```

### Best Practice Rules

#### require-primary-key

Requires all tables to have a primary key.

```typescript
'require-primary-key': 'error'
```

```typescript
// Valid
pgTable('users', {
  id: uuid('id').primaryKey(),
})

// Invalid - no primary key
pgTable('logs', {
  message: text('message'),
})
```

#### prefer-uuid-pk

Recommends using UUID instead of serial/integer for primary keys.

```typescript
'prefer-uuid-pk': 'warn'
```

```typescript
// Recommended
pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
})

// Warning - using serial
pgTable('users', {
  id: serial('id').primaryKey(),
})
```

#### require-timestamps

Requires tables to have `created_at` and `updated_at` columns.

```typescript
'require-timestamps': 'warn'
```

```typescript
// Valid
pgTable('users', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Warning - missing timestamps
pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name'),
})
```

#### index-foreign-keys

Requires indexes on foreign key columns for query performance.

```typescript
'index-foreign-keys': 'warn'
```

```typescript
// Valid - has index
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
}, (table) => ({
  userIdIdx: index('orders_user_id_idx').on(table.userId),
}));

// Warning - foreign key without index
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id),
});
```

### Security Rules

#### no-cascade-delete

Warns against using CASCADE DELETE, which can cause unintended data loss.

```typescript
'no-cascade-delete': 'warn'
```

```typescript
// Warning - CASCADE DELETE
userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' })

// Better - SET NULL or RESTRICT
userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' })
```

#### require-soft-delete

Requires a `deleted_at` column for soft delete pattern.

```typescript
'require-soft-delete': 'off'  // Disabled by default
```

```typescript
// Valid when enabled
pgTable('users', {
  id: uuid('id').primaryKey(),
  deletedAt: timestamp('deleted_at'),
})

// Invalid when enabled - no soft delete column
pgTable('users', {
  id: uuid('id').primaryKey(),
})
```

## CLI Options

```bash
npx drizzle-multitenant lint [options]
```

| Option | Description |
|--------|-------------|
| `--tenant-schema <path>` | Tenant schema directory |
| `--shared-schema <path>` | Shared schema directory |
| `--format <type>` | Output format: `console`, `json`, `github` |
| `--rule <name>` | Enable specific rule (can repeat) |
| `--ignore-rule <name>` | Disable specific rule (can repeat) |
| `--json` | Alias for `--format=json` |

### Examples

```bash
# Lint only tenant schemas
npx drizzle-multitenant lint --tenant-schema=./src/db/schema/tenant

# Lint only shared schemas
npx drizzle-multitenant lint --shared-schema=./src/db/schema/shared

# Enable only specific rules
npx drizzle-multitenant lint --rule=require-primary-key --rule=table-naming

# Ignore specific rules
npx drizzle-multitenant lint --ignore-rule=require-soft-delete
```

## Output Formats

### Console (Default)

```bash
npx drizzle-multitenant lint
```

```
Schema Validation Results

  tenant/users.ts
    ⚠ Line 12: [require-timestamps] Missing 'updatedAt' column

  tenant/orders.ts
    ⚠ Line 8: [index-foreign-keys] Missing index on foreign key 'userId'

  shared/plans.ts
    ✗ Line 5: [prefer-uuid-pk] Using 'serial' instead of 'uuid' for primary key

Summary: 12 schemas validated, 2 warnings, 1 error
```

### JSON

```bash
npx drizzle-multitenant lint --format=json
```

```json
{
  "success": false,
  "totalSchemas": 12,
  "errors": 1,
  "warnings": 2,
  "issues": [
    {
      "file": "tenant/users.ts",
      "line": 12,
      "column": 1,
      "rule": "require-timestamps",
      "severity": "warn",
      "message": "Missing 'updatedAt' column"
    },
    {
      "file": "tenant/orders.ts",
      "line": 8,
      "column": 1,
      "rule": "index-foreign-keys",
      "severity": "warn",
      "message": "Missing index on foreign key 'userId'"
    },
    {
      "file": "shared/plans.ts",
      "line": 5,
      "column": 1,
      "rule": "prefer-uuid-pk",
      "severity": "error",
      "message": "Using 'serial' instead of 'uuid' for primary key"
    }
  ]
}
```

### GitHub Actions

```bash
npx drizzle-multitenant lint --format=github
```

```
::warning file=tenant/users.ts,line=12::[require-timestamps] Missing 'updatedAt' column
::warning file=tenant/orders.ts,line=8::[index-foreign-keys] Missing index on foreign key 'userId'
::error file=shared/plans.ts,line=5::[prefer-uuid-pk] Using 'serial' instead of 'uuid' for primary key
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/lint.yml
name: Schema Lint

on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - name: Lint database schemas
        run: npx drizzle-multitenant lint --format=github
```

### Pre-commit Hook

Using husky:

```bash
# .husky/pre-commit
npx drizzle-multitenant lint
```

### GitLab CI

```yaml
# .gitlab-ci.yml
schema-lint:
  stage: test
  script:
    - npm ci
    - npx drizzle-multitenant lint --format=json > lint-report.json
  artifacts:
    reports:
      codequality: lint-report.json
```

## Programmatic API

```typescript
import { SchemaLinter } from 'drizzle-multitenant/lint';

const linter = new SchemaLinter({
  rules: {
    'table-naming': ['error', { style: 'snake_case' }],
    'require-primary-key': 'error',
  },
});

// Lint schemas
const results = await linter.lint({
  tenantSchemaPath: './src/db/schema/tenant',
  sharedSchemaPath: './src/db/schema/shared',
});

console.log(`Errors: ${results.errors}, Warnings: ${results.warnings}`);

for (const issue of results.issues) {
  console.log(`${issue.file}:${issue.line} - [${issue.rule}] ${issue.message}`);
}

// Exit with error if there are errors
if (!results.success) {
  process.exit(1);
}
```

## Custom Rules

You can extend the linter with custom rules:

```typescript
import { SchemaLinter, LintRule } from 'drizzle-multitenant/lint';

const customRule: LintRule = {
  name: 'require-tenant-id',
  severity: 'error',
  validate: (schema) => {
    const issues = [];
    for (const table of schema.tables) {
      if (!table.columns.some(c => c.name === 'tenant_id')) {
        issues.push({
          line: table.line,
          message: `Table '${table.name}' missing tenant_id column`,
        });
      }
    }
    return issues;
  },
};

const linter = new SchemaLinter({
  rules: {
    'require-tenant-id': 'error',
  },
  customRules: [customRule],
});
```

## Interactive Menu

The interactive menu includes schema linting:

```bash
npx drizzle-multitenant
```

```
? drizzle-multitenant - Main Menu
  ...
  Schema Lint                 ← Run schema validation
  ...
```

## Best Practices

1. **Start with warnings**: Set rules to `warn` initially, then upgrade to `error`
2. **Run in CI**: Catch issues before they reach production
3. **Configure per-project**: Different projects may need different rules
4. **Fix incrementally**: Don't try to fix everything at once
5. **Document exceptions**: If you disable a rule, document why

## See Also

- [Scaffolding](/guide/scaffold) - Generate lint-compliant schemas
- [Configuration](/guide/configuration) - Full configuration reference
- [CLI Commands](/guide/cli) - Complete CLI documentation
