# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**drizzle-multitenant** is a multi-tenancy toolkit for Drizzle ORM with PostgreSQL schema isolation, tenant context propagation, and parallel migrations.

### Key Features
- **Schema Isolation**: Automatic PostgreSQL schema-per-tenant with LRU pool management
- **Context Propagation**: AsyncLocalStorage-based tenant context across the entire stack
- **Parallel Migrations**: Apply migrations to all tenants concurrently with progress tracking
- **Cross-Schema Queries**: Type-safe queries joining tenant and shared schemas
- **Framework Integrations**: Express, Fastify, NestJS middlewares/plugins
- **CLI Tools**: Generate migrations, manage tenants, check status

### Project Statistics
- **Primary Language**: TypeScript (strict mode)
- **Version**: 1.1.0
- **License**: MIT
- **Node.js**: >= 18.0.0
- **Test Coverage**: 27 test suites, 644 tests

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- npm or pnpm

### Initial Setup
```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Watch mode for development
npm run dev
```

## Essential Commands

### Development
```bash
npm run dev          # Watch mode with tsup
npm run build        # Build with tsup (ESM + types)
npm test             # Run vitest tests
npm run test:coverage # Tests with v8 coverage
npm run typecheck    # TypeScript type check (no emit)
npm run lint         # ESLint check
```

### CLI Commands
```bash
# Initialize configuration
npx drizzle-multitenant init

# Generate migration
npx drizzle-multitenant generate --name=add-users

# Apply migrations to all tenants
npx drizzle-multitenant migrate --all --concurrency=10

# Check migration status
npx drizzle-multitenant status

# Sync divergences
npx drizzle-multitenant sync --status

# Create/drop tenant
npx drizzle-multitenant tenant:create --id=new-tenant
npx drizzle-multitenant tenant:drop --id=old-tenant --force
```

## Architecture and Key Concepts

### 1. Pool Manager (Facade)
**Location**: `src/pool.ts` (facade), `src/pool/` (internals)

The `PoolManager` class handles tenant database connections with LRU eviction.
Internally delegates to specialized modules:
- `PoolCache`: LRU cache with configurable `maxPools` (default: 50)
- `RetryHandler`: Exponential backoff with jitter for connection retries
- `HealthChecker`: Pool health monitoring and metrics

Features:
- Creates PostgreSQL pools with schema-specific `search_path`
- TTL-based cleanup with `poolTtlMs` (default: 1 hour)
- Automatic eviction of least recently used pools

```typescript
// Connection is created with search_path for isolation
options: `-c search_path=${schemaName},public`
```

### 2. Tenant Context (AsyncLocalStorage)
**Location**: `src/context.ts`

Uses Node.js `AsyncLocalStorage` for context propagation without parameter drilling:
- `runWithTenant()`: Execute callback within tenant context
- `getTenantId()`: Get current tenant ID (throws if outside context)
- `getTenantDb()`: Get Drizzle instance for current tenant
- `isInTenantContext()`: Check if inside tenant context

### 3. Configuration System
**Location**: `src/config.ts`

`defineConfig()` validates configuration at runtime:
- `connection.url`: Required PostgreSQL connection string
- `isolation.strategy`: Only "schema" is supported
- `isolation.schemaNameTemplate`: Function to generate schema names
- `schemas.tenant`: Required Drizzle schema for tenant tables
- `schemas.shared`: Optional shared schema (public)

### 4. Migration Engine (Facade)
**Location**: `src/migrator/migrator.ts` (facade), `src/migrator/` (modules)

The `Migrator` class orchestrates tenant migrations through specialized modules:
- `MigrationExecutor`: Single tenant migration execution
- `BatchExecutor`: Parallel batch processing with configurable concurrency
- `SchemaManager`: Create/drop tenant schemas
- `SyncManager`: Detect and resolve migration divergences
- `DriftDetector`: Compare schemas across tenants (columns, indexes, constraints)
- `Seeder`: Apply seed data to tenants

Features:
- Three table formats: `name`, `hash`, `drizzle-kit`
- Auto-detect format with fallback
- Dry-run and mark-applied modes
- Progress callbacks and error handlers

### 5. Cross-Schema Queries
**Location**: `src/cross-schema/`

Two builders for joining tenant and shared tables:
- `withShared()`: Automatic schema detection (recommended)
- `createCrossSchemaQuery()`: Manual schema specification

```typescript
// Simplified API with automatic detection
await withShared(tenantDb, sharedDb, { tenant: schema1, shared: schema2 })
  .from(orders)
  .leftJoin(plans, eq(orders.planId, plans.id))
  .select({ orderId: orders.id, planName: plans.name })
  .execute();
```

### 6. Framework Integrations

| Framework | Location | Pattern |
|-----------|----------|---------|
| Express | `src/integrations/express.ts` | Middleware with `req.tenantContext` |
| Fastify | `src/integrations/fastify.ts` | Plugin with `preHandler` hook |
| NestJS | `src/integrations/nestjs/` | Module with decorators and guards |
| Hono | `src/integrations/hono.ts` | Placeholder (not implemented) |

## Project Structure

```
src/
├── index.ts                 # Public exports
├── types.ts                 # Global type definitions
├── config.ts                # Configuration validation
├── context.ts               # AsyncLocalStorage context
├── manager.ts               # TenantManager factory
├── pool.ts                  # LRU pool manager (facade)
├── debug.ts                 # Structured debug logging
├── retry.ts                 # Retry utilities
├── pool/                    # Pool internals (extracted)
│   ├── interfaces.ts        # Pool interfaces
│   ├── cache/
│   │   ├── index.ts
│   │   └── pool-cache.ts    # LRU cache implementation
│   ├── retry/
│   │   ├── index.ts
│   │   └── retry-handler.ts # Exponential backoff
│   └── health/
│       ├── index.ts
│       └── health-checker.ts # Health check logic
├── integrations/
│   ├── express.ts           # Express middleware
│   ├── fastify.ts           # Fastify plugin
│   ├── hono.ts              # Hono (placeholder)
│   └── nestjs/              # NestJS module
│       ├── index.ts         # Exports
│       ├── tenant.module.ts # forRoot/forRootAsync
│       ├── decorators.ts    # @InjectTenantDb, etc.
│       ├── guards.ts        # TenantGuard
│       ├── interceptors.ts  # Context interceptor
│       ├── providers.ts     # DI providers
│       └── factory.ts       # TenantDbFactory
├── migrator/
│   ├── index.ts             # Exports
│   ├── migrator.ts          # Migrator class (facade)
│   ├── types.ts             # Migration types
│   ├── interfaces.ts        # Internal interfaces
│   ├── table-format.ts      # Format detection/conversion
│   ├── schema-manager.ts    # Schema create/drop
│   ├── executor/            # Migration execution
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── migration-executor.ts  # Single tenant
│   │   └── batch-executor.ts      # Parallel execution
│   ├── sync/                # Divergence sync
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── sync-manager.ts
│   ├── drift/               # Schema drift detection
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── drift-detector.ts
│   │   ├── column-analyzer.ts
│   │   ├── index-analyzer.ts
│   │   └── constraint-analyzer.ts
│   └── seed/                # Tenant seeding
│       ├── index.ts
│       ├── types.ts
│       └── seeder.ts
├── cross-schema/
│   ├── index.ts             # Exports
│   ├── cross-schema.ts      # CrossSchemaQueryBuilder
│   ├── with-shared.ts       # withShared() helper
│   └── types.ts             # Cross-schema types
└── cli/
    ├── index.ts             # CLI entry point
    ├── commands/            # All CLI commands
    │   ├── migrate.ts
    │   ├── status.ts
    │   ├── sync.ts
    │   ├── generate.ts
    │   ├── tenant-create.ts
    │   ├── tenant-drop.ts
    │   ├── convert-format.ts
    │   ├── init.ts
    │   └── completion.ts
    ├── utils/               # CLI utilities
    │   ├── config.ts
    │   ├── output.ts
    │   ├── errors.ts
    │   ├── progress.ts
    │   ├── spinner.ts
    │   └── table.ts
    └── ui/                  # Interactive UI
        ├── index.ts
        ├── types.ts
        ├── menu.ts          # Main menu (orchestrator)
        ├── banner.ts
        ├── base/
        │   ├── index.ts
        │   └── menu-renderer.ts
        └── screens/
            ├── index.ts
            ├── status-screen.ts
            ├── migrations-screen.ts
            ├── tenants-screen.ts
            ├── seeding-screen.ts
            └── generate-screen.ts
```

## Important Patterns

### Adding New Features

1. **New Core Feature**:
   - Add implementation in `src/`
   - Add types to `src/types.ts`
   - Export from `src/index.ts`
   - Add tests as `*.test.ts` next to implementation

2. **New CLI Command**:
   - Create `src/cli/commands/<command>.ts`
   - Register in `src/cli/commands/index.ts`
   - Use `CLIErrors` for error handling
   - Support `--json` output for scripting

3. **New Integration**:
   - Create `src/integrations/<framework>.ts`
   - Add entry point in `tsup.config.ts`
   - Add export in `package.json` exports
   - Create corresponding test file

4. **Documentation**:
   - All documentation lives in `website/` (VitePress)
   - Guide pages: `website/guide/*.md`
   - API reference: `website/api/reference.md`
   - Examples: `website/examples/*.md` (full code, no separate files)
   - Framework guides: `website/guide/frameworks/*.md`
   - Update sidebar in `website/.vitepress/config.ts`
   - Version is dynamic from `package.json`

### Testing Approach

- **Framework**: Vitest with globals enabled
- **Pattern**: Tests collocated with source (`*.test.ts`)
- **Mocking**: Use `vi.mock()` for external dependencies (pg, drizzle-orm)
- **Cleanup**: Always call `manager.dispose()` in `afterEach`

```typescript
// Standard test setup
beforeEach(() => {
  vi.clearAllMocks();
  manager = new PoolManager(config);
});

afterEach(async () => {
  await manager.dispose();
});
```

### Error Handling

- **CLI Errors**: Use `CLIError` class with suggestion, example, docs
- **Runtime Errors**: Throw descriptive errors with `[drizzle-multitenant]` prefix
- **Custom Errors**: `TenantNotFoundError`, `TenantValidationError`

```typescript
// CLI error pattern
throw CLIErrors.configNotFound(['./tenant.config.ts', './drizzle.config.ts']);

// Runtime error pattern
throw new Error('[drizzle-multitenant] connection.url is required');
```

### Hooks Pattern

Lifecycle hooks are used throughout:
```typescript
hooks: {
  onPoolCreated?: (tenantId: string) => void | Promise<void>;
  onPoolEvicted?: (tenantId: string) => void | Promise<void>;
  onError?: (tenantId: string, error: Error) => void | Promise<void>;
}
```

## Code Style

### Naming Conventions
| Element | Convention | Example |
|---------|------------|---------|
| Files | camelCase | `poolManager.ts` |
| Directories | kebab-case | `cross-schema/` |
| Classes | PascalCase | `PoolManager` |
| Functions | camelCase | `createTenantManager` |
| Interfaces | PascalCase | `TenantContext` |
| Constants | UPPER_SNAKE | `DEFAULT_CONFIG` |
| Generics | TPrefix | `TTenantSchema`, `TSharedSchema` |

### TypeScript Patterns
- Strict mode with `exactOptionalPropertyTypes`
- Generics for type safety across layers
- Type imports: `import type { Config } from './types.js'`
- ESM imports with `.js` extension

### Documentation
- JSDoc with `@example` for all public APIs
- Inline comments for complex logic
- No TODO/FIXME in production code

## Hidden Context

### PostgreSQL Search Path
The key to schema isolation is the `search_path` option:
```typescript
options: `-c search_path=${schemaName},public`
```
This allows tenant queries to find tables in their schema first, then fall back to public for shared tables.

### LRU Eviction
Pools are evicted based on:
1. LRU when `maxPools` is reached
2. TTL when `poolTtlMs` expires (checked every minute)

### AsyncLocalStorage Isolation
Each concurrent request maintains its own tenant context. The `runWithTenant()` wrapper ensures isolation between parallel requests.

### Migration Table Formats
Three formats are supported for backward compatibility:
- `name`: Filename-based (native)
- `hash`: SHA-256 hash
- `drizzle-kit`: Exact drizzle-kit format

### NestJS Lazy Resolution
`TENANT_DB` and `TENANT_CONTEXT` use Proxy for lazy resolution to avoid circular dependencies in singleton services.

## Dependencies

### Core (Peer)
- `drizzle-orm`: >= 0.29.0
- `pg`: >= 8.0.0

### Runtime
- `lru-cache`: Pool management
- `commander`: CLI framework
- `chalk`, `ora`, `cli-progress`, `cli-table3`: CLI output
- `@inquirer/prompts`: Interactive prompts

### Development
- `tsup`: Build bundler
- `vitest`: Test framework
- `typescript`: Strict mode

### Framework-Specific
- `@nestjs/common`, `@nestjs/core`: NestJS integration
- `express`: Express middleware
- `fastify`, `fastify-plugin`: Fastify plugin

## Build and Publish

### Build Output
```
dist/
├── index.js                    # Core exports
├── integrations/
│   ├── express.js
│   ├── fastify.js
│   ├── nestjs/index.js
│   └── hono.js
├── migrator/index.js
├── cross-schema/index.js
└── cli/index.js
```

### Package Exports
```json
{
  ".": "./dist/index.js",
  "./express": "./dist/integrations/express.js",
  "./fastify": "./dist/integrations/fastify.js",
  "./nestjs": "./dist/integrations/nestjs/index.js",
  "./migrator": "./dist/migrator/index.js",
  "./cross-schema": "./dist/cross-schema/index.js"
}
```

## Debugging

### Debug Mode
Enable structured logging in development:
```typescript
defineConfig({
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    logQueries: true,
    logPoolEvents: true,
    slowQueryThreshold: 1000,
  },
});
```

### Debug Output
```
[drizzle-multitenant] tenant=abc POOL_CREATED schema=tenant_abc
[drizzle-multitenant] tenant=abc query="SELECT..." duration=45ms
[drizzle-multitenant] tenant=abc SLOW_QUERY duration=1523ms query="..."
```

### NestJS Debug Info
```typescript
console.log(tenantDb.__debug);
// { tenantId: '123', schemaName: 'tenant_123', isProxy: true, poolCount: 5 }
```

## Common Issues

### Issue: "No table specified"
**Cause**: Calling `.execute()` without `.from()` in cross-schema query
**Solution**: Always call `.from(table)` before `.execute()`

### Issue: Pool exhaustion
**Cause**: Too many concurrent tenants, not enough `maxPools`
**Solution**: Increase `maxPools` or decrease `poolTtlMs`

### Issue: Context not available
**Cause**: Accessing tenant context outside `runWithTenant()`
**Solution**: Use `isInTenantContext()` to check, or use `getTenantOrNull()`

### Issue: Migration format mismatch
**Cause**: Existing migrations in different format
**Solution**: Use `npx drizzle-multitenant convert-format --to=name`

## Git Workflow

### Commit Convention
```
feat(module): description    # New feature
fix(module): description     # Bug fix
refactor(module): description # Refactoring
docs: description            # Documentation
test(module): description    # Tests
chore: description           # Maintenance
```

### Recent Evolution
- v1.1.0: Major refactoring - extracted modules from god components (Migrator, PoolManager, CLI Menu)
- v1.0.8: Debug mode, warmup, sync command
- v1.0.7: Mark-applied option
- v1.0.5: JSON output, format detection
- v1.0.3: TenantDbFactory for singletons
- v1.0.0: Initial release with core features

## API Reference

### Core Exports
| Export | Description |
|--------|-------------|
| `defineConfig()` | Create typed configuration |
| `createTenantManager()` | Create pool manager instance |
| `createTenantContext()` | Create AsyncLocalStorage context |
| `withShared()` | Simplified cross-schema query builder |
| `createCrossSchemaQuery()` | Manual cross-schema query builder |
| `createMigrator()` | Create migration engine |

### TenantManager Methods
| Method | Description |
|--------|-------------|
| `getDb(tenantId)` | Get Drizzle instance for tenant |
| `getSharedDb()` | Get Drizzle instance for shared schema |
| `getSchemaName(tenantId)` | Get schema name for tenant |
| `hasPool(tenantId)` | Check if pool exists |
| `getPoolCount()` | Get count of active pools |
| `evictPool(tenantId)` | Force evict a pool |
| `warmup(tenantIds, options?)` | Pre-warm pools |
| `dispose()` | Cleanup all pools |

### NestJS Decorators
| Decorator | Description |
|-----------|-------------|
| `@InjectTenantDb()` | Inject tenant database (request-scoped) |
| `@InjectTenantDbFactory()` | Inject factory for singleton services |
| `@InjectSharedDb()` | Inject shared database |
| `@InjectTenantContext()` | Inject tenant context |
| `@InjectTenantManager()` | Inject tenant manager |
| `@RequiresTenant()` | Mark route as requiring tenant |
| `@PublicRoute()` | Mark route as public |
