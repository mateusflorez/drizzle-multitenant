# Proposal: Shared Schema Config from drizzle.config.ts

## Problem Statement

Currently, shared schema migrations require manual configuration in `tenant.config.ts`:

```typescript
// tenant.config.ts
export default {
  ...config,
  migrations: {
    sharedFolder: "./drizzle",
    sharedTable: "__drizzle_migrations",
    // ...
  },
};
```

This is problematic because:

1. **Duplication**: Projects already have a `drizzle.config.ts` with shared schema settings
2. **Sync issues**: Two config files for the same schema leads to drift
3. **Manual table detection**: Users must manually specify the migrations table name

## Proposed Solution

### 1. Read Shared Schema Config from drizzle.config.ts

Instead of requiring shared schema settings in `tenant.config.ts`, read them directly from the project's existing `drizzle.config.ts`:

**drizzle.config.ts** (existing drizzle-kit config):
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schemas/schema.js",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    schema: "public",
  },
});
```

**tenant.config.ts** (drizzle-multitenant config):
```typescript
import { defineConfig } from "drizzle-multitenant";

export default defineConfig({
  connection: { url: process.env.DATABASE_URL! },
  isolation: {
    strategy: "schema",
    schemaNameTemplate: (id) => `tenant_${id}`,
  },
  schemas: {
    tenant: tenantSchema,
    shared: sharedSchema,
  },
  migrations: {
    tenantFolder: "./drizzle/tenant",
    tenantDiscovery: discoverTenants,
    // No shared config needed - read from drizzle.config.ts
  },
});
```

### 2. Auto-Detection for Shared Table Format

Apply the same table format auto-detection that exists for tenants to the shared schema:

```typescript
interface SharedMigrationsConfig {
  /**
   * Table format detection strategy
   * @default 'auto'
   */
  sharedTableFormat?: 'auto' | 'name' | 'hash' | 'drizzle-kit';
}
```

**Format Detection Logic** (same as tenants):

| Format | Identifier Column | Timestamp Column | Timestamp Type |
|--------|------------------|------------------|----------------|
| `name` | `name` | `applied_at` | `timestamp` |
| `hash` | `hash` | `created_at` | `timestamp` |
| `drizzle-kit` | `hash` | `created_at` | `bigint` |

When `sharedTableFormat: 'auto'` (default):
1. Check if migrations table exists in public schema
2. Inspect columns to detect format
3. Use detected format for reading applied migrations

---

## Implementation

### 1. Config Loading Changes

**File**: `src/cli/utils/config.ts`

```typescript
const DRIZZLE_KIT_CONFIG_NAMES = [
  'drizzle.config.ts',
  'drizzle.config.js',
  'drizzle.config.mjs',
];

interface DrizzleKitConfig {
  out?: string;
  schema?: string;
  dialect?: string;
  migrations?: {
    table?: string;
    schema?: string;
  };
}

/**
 * Load drizzle-kit config for shared schema settings
 */
async function loadDrizzleKitConfig(): Promise<DrizzleKitConfig | null> {
  const cwd = process.cwd();

  for (const name of DRIZZLE_KIT_CONFIG_NAMES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) {
      const ext = extname(path);
      if (ext === '.ts') {
        await registerTypeScript();
      }

      const configUrl = pathToFileURL(path).href;
      const module = await import(configUrl);
      return module.default ?? module;
    }
  }

  return null;
}

export interface LoadedConfig {
  config: Config<Record<string, unknown>, Record<string, unknown>>;
  migrationsFolder?: string;
  migrationsTable?: string;
  tenantDiscovery?: () => Promise<string[]>;

  // Shared schema (from drizzle.config.ts)
  sharedMigrationsFolder?: string;
  sharedMigrationsTable?: string;
  sharedTableFormat?: 'auto' | 'name' | 'hash' | 'drizzle-kit';
}

export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  // Load tenant config (existing logic)
  const tenantConfig = await loadTenantConfig(configPath);

  // Load drizzle-kit config for shared schema
  const drizzleKitConfig = await loadDrizzleKitConfig();

  return {
    config: tenantConfig.config,
    migrationsFolder: tenantConfig.migrations?.tenantFolder,
    migrationsTable: tenantConfig.migrations?.migrationsTable,
    tenantDiscovery: tenantConfig.migrations?.tenantDiscovery,

    // Shared schema from drizzle.config.ts
    sharedMigrationsFolder: drizzleKitConfig?.out,
    sharedMigrationsTable: drizzleKitConfig?.migrations?.table ?? '__drizzle_migrations',
    sharedTableFormat: tenantConfig.migrations?.sharedTableFormat ?? 'auto',
  };
}
```

### 2. Migrator Changes

**File**: `src/migrator/types.ts`

```typescript
export interface MigratorConfig {
  // Existing tenant config...
  migrationsFolder: string;
  migrationsTable?: string;
  tableFormat?: 'auto' | TableFormat;

  // Shared schema config
  sharedMigrationsFolder?: string;
  sharedMigrationsTable?: string;
  sharedTableFormat?: 'auto' | 'name' | 'hash' | 'drizzle-kit';
}
```

**File**: `src/migrator/migrator.ts`

```typescript
/**
 * Get or detect the format for the shared schema
 * Uses same detection logic as tenants
 */
private async getOrDetectSharedFormat(
  pool: Pool,
  schemaName: string
): Promise<DetectedFormat> {
  const tableName = this.migratorConfig.sharedMigrationsTable ?? '__drizzle_migrations';
  const configuredFormat = this.migratorConfig.sharedTableFormat ?? 'auto';

  // If format is explicitly set, use it
  if (configuredFormat !== 'auto') {
    return getFormatConfig(configuredFormat, tableName);
  }

  // Auto-detect from existing table
  const detected = await detectTableFormat(pool, schemaName, tableName);

  if (detected) {
    return detected;
  }

  // No table exists, use 'name' format (drizzle-multitenant native)
  return getFormatConfig('name', tableName);
}
```

### 3. CLI Menu Changes

**File**: `src/cli/ui/menu.ts`

Update `loadMenuContext()` to use the new config loading:

```typescript
private async loadMenuContext(): Promise<MenuContext | null> {
  const spinner = ora('Loading configuration...').start();

  try {
    const loaded = await loadConfig(this.configPath);

    // Shared migrations are available if drizzle.config.ts exists
    this.hasSharedMigrations = !!loaded.sharedMigrationsFolder;

    spinner.succeed('Configuration loaded');

    if (loaded.sharedMigrationsFolder) {
      console.log(chalk.dim(`  └─ Shared schema: ${loaded.sharedMigrationsFolder}`));
    }

    return {
      config: loaded.config,
      migrationsFolder: loaded.migrationsFolder,
      migrationsTable: loaded.migrationsTable,
      tenantDiscovery: loaded.tenantDiscovery,
      sharedMigrationsFolder: loaded.sharedMigrationsFolder,
      sharedMigrationsTable: loaded.sharedMigrationsTable,
      sharedTableFormat: loaded.sharedTableFormat,
    };
  } catch (error) {
    spinner.fail('Failed to load configuration');
    return null;
  }
}
```

---

## User Experience

### Before (current)

```
? drizzle-multitenant - Main Menu
> Migration Status (7 ok, 0 pending)
  Migrate Tenants (all up to date)
  Seed Tenants
  ──────────────
  Create Tenant
  ...
```

User must manually configure `sharedFolder` and `sharedTable` in tenant.config.ts.

### After (proposed)

```
✔ Loading configuration...
  └─ Shared schema: ./drizzle (from drizzle.config.ts)

? drizzle-multitenant - Main Menu
> Migration Status (7 ok, 0 pending)
  Migrate Tenants (all up to date)
  Shared Migrations              ← Manage shared migrations
  ──────────────
  Seed Tenants
  Seed Shared                    ← Seed shared schema
  ──────────────
  Create Tenant
  ...
```

Automatic detection from existing drizzle.config.ts.

---

## Config Override (Optional)

If users need to override the drizzle.config.ts settings:

```typescript
// tenant.config.ts
export default {
  ...config,
  migrations: {
    tenantFolder: "./drizzle/tenant",
    tenantDiscovery: discoverTenants,

    // Optional: override drizzle.config.ts settings
    sharedFolder: "./custom/shared",
    sharedTableFormat: 'drizzle-kit', // force specific format
  },
};
```

Priority: `tenant.config.ts` > `drizzle.config.ts` > defaults

---

## Implementation Checklist

- [x] Add `loadDrizzleKitConfig()` in `src/cli/utils/config.ts`
- [x] Update `LoadedConfig` interface with shared schema fields
- [ ] Add `sharedTableFormat` option to `MigratorConfig`
- [ ] Update `getOrDetectSharedFormat()` to use `sharedTableFormat`
- [ ] Update CLI menu to show drizzle.config.ts detection
- [ ] Add tests for drizzle.config.ts loading
- [ ] Add tests for shared table format auto-detection
- [ ] Update documentation

---

## Breaking Changes

None. This is backward compatible:

- Existing `tenant.config.ts` with `sharedFolder`/`sharedTable` still works
- Projects without `drizzle.config.ts` are unaffected
- Default behavior unchanged for new projects

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| Shared config source | `tenant.config.ts` only | `drizzle.config.ts` (auto) |
| Table format detection | Manual | Auto (like tenants) |
| Config duplication | Required | Eliminated |
| Integration effort | High | Zero (if drizzle.config.ts exists) |
