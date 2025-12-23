# Proposal: drizzle-multitenant

> Multi-tenancy toolkit for Drizzle ORM with schema isolation, tenant context, and parallel migrations.

## Visão Geral

Package open-source que abstrai complexidades de multi-tenancy para projetos usando Drizzle ORM + PostgreSQL. Inspirado em padrões battle-tested do PrimeSys, mas genérico o suficiente para qualquer projeto.

**Problema**: Implementar multi-tenancy com Drizzle requer muito boilerplate:
- Pool management manual com cleanup
- Context propagation através de camadas
- Migrations em múltiplos schemas
- Cross-schema queries sem type-safety

**Solução**: API declarativa que resolve tudo isso.

---

## Features Principais

### 1. Schema Isolation Automático
### 2. Middleware de Contexto de Tenant
### 3. Migrations Paralelas por Tenant
### 4. Cross-Schema Queries Tipadas
### 5. tenant.config.ts com Geração de Migrations

---

## 1. Schema Isolation Automático

### API Design

```typescript
// tenant.config.ts
import { defineConfig } from 'drizzle-multitenant';
import * as tenantSchema from './schemas/tenant';
import * as sharedSchema from './schemas/shared';

export default defineConfig({
  // Conexão base
  connection: {
    url: process.env.DATABASE_URL!,
    poolConfig: {
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  },

  // Estratégia de isolamento
  isolation: {
    strategy: 'schema',  // 'schema' | 'database' | 'row'

    // Naming convention para schemas de tenant
    schemaNameTemplate: (tenantId: string) => `tenant_${tenantId.replace(/-/g, '_')}`,

    // Limite de pools simultâneos (LRU eviction)
    maxPools: 50,

    // TTL de inatividade antes de cleanup
    poolTtlMs: 60 * 60 * 1000, // 1 hour
  },

  // Schemas Drizzle
  schemas: {
    tenant: tenantSchema,   // Aplicado por tenant
    shared: sharedSchema,   // Schema público/compartilhado
  },

  // Hooks para observabilidade
  hooks: {
    onPoolCreated: (tenantId) => console.log(`Pool created: ${tenantId}`),
    onPoolEvicted: (tenantId) => console.log(`Pool evicted: ${tenantId}`),
    onError: (tenantId, error) => Sentry.captureException(error),
  },
});
```

### Uso no Código

```typescript
import { createTenantManager } from 'drizzle-multitenant';
import config from './tenant.config';

const tenants = createTenantManager(config);

// Obter DB tipado para um tenant
const db = tenants.getDb('tenant-uuid-here');

// Queries são automaticamente scopadas ao schema do tenant
const users = await db.select().from(schema.users);

// DB compartilhado (public schema)
const shared = tenants.getSharedDb();
const plans = await shared.select().from(sharedSchema.subscriptionPlans);
```

### Pool Management Interno

```typescript
// Internamente, o manager cuida de:
class TenantPoolManager {
  private pools: LRUCache<string, PoolEntry>;
  private cleanupInterval: NodeJS.Timeout;

  getDb(tenantId: string) {
    const schemaName = this.config.isolation.schemaNameTemplate(tenantId);

    let entry = this.pools.get(schemaName);
    if (!entry) {
      entry = this.createPool(schemaName);
      this.pools.set(schemaName, entry);
      this.config.hooks?.onPoolCreated?.(tenantId);
    }

    entry.lastAccess = Date.now();
    return entry.db;
  }

  private createPool(schemaName: string): PoolEntry {
    const pool = new Pool({
      ...this.config.connection.poolConfig,
      connectionString: this.config.connection.url,
      options: `-c search_path=${schemaName},public`,
    });

    pool.on('error', async (err) => {
      this.config.hooks?.onError?.(schemaName, err);
      await this.disposePool(schemaName);
    });

    return {
      db: drizzle(pool, { schema: this.config.schemas.tenant }),
      pool,
      lastAccess: Date.now(),
    };
  }

  // Cleanup automático via interval
  private startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.pools.entries()) {
        if (now - entry.lastAccess > this.config.isolation.poolTtlMs) {
          this.disposePool(key);
          this.config.hooks?.onPoolEvicted?.(key);
        }
      }
    }, 60_000); // Check every minute
  }
}
```

---

## 2. Middleware de Contexto de Tenant

### AsyncLocalStorage para Context Propagation

```typescript
import { createTenantContext } from 'drizzle-multitenant';

// Cria contexto com AsyncLocalStorage
const tenantContext = createTenantContext<{
  tenantId: string;
  userId?: string;
  permissions?: string[];
}>();

// Acesso global ao tenant atual
export const {
  runWithTenant,   // Executa callback com contexto
  getTenant,       // Obtém tenant atual
  getTenantDb,     // Obtém DB do tenant atual
} = tenantContext;
```

### Express/Fastify Middleware

```typescript
import { createExpressMiddleware } from 'drizzle-multitenant/express';

const tenantMiddleware = createExpressMiddleware({
  // Extrair tenant ID da request
  extractTenantId: (req) => {
    // Via header
    return req.headers['x-tenant-id'] as string;
    // Ou via path param
    // return req.params.tenantId;
    // Ou via subdomain
    // return req.hostname.split('.')[0];
  },

  // Validação opcional
  validateTenant: async (tenantId) => {
    const exists = await checkTenantExists(tenantId);
    if (!exists) throw new TenantNotFoundError(tenantId);
    return true;
  },

  // Contexto adicional
  enrichContext: async (tenantId, req) => ({
    userId: req.user?.id,
    permissions: req.user?.permissions,
  }),
});

app.use('/api/:tenantId/*', tenantMiddleware);
```

### NestJS Integration

```typescript
import { TenantModule, InjectTenantDb, TenantContext } from 'drizzle-multitenant/nestjs';

@Module({
  imports: [
    TenantModule.forRoot({
      config: tenantConfig,
      extractTenantId: (req) => req.params.empresaId,
    }),
  ],
})
export class AppModule {}

// No service
@Injectable()
export class UserService {
  constructor(
    @InjectTenantDb() private readonly db: TenantDb,
    @InjectTenantContext() private readonly ctx: TenantContext,
  ) {}

  async findAll() {
    // db já está scopado ao tenant correto
    return this.db.select().from(users);
  }

  async findWithAudit() {
    const result = await this.db.select().from(users);

    // Contexto disponível para audit
    console.log(`Query by user ${this.ctx.userId} on tenant ${this.ctx.tenantId}`);

    return result;
  }
}
```

### Uso Direto (sem framework)

```typescript
import { runWithTenant, getTenantDb } from './context';

async function processOrder(tenantId: string, orderId: string) {
  return runWithTenant({ tenantId }, async () => {
    const db = getTenantDb();

    // Todas as queries dentro deste callback usam o tenant correto
    const order = await db.select().from(orders).where(eq(orders.id, orderId));

    // Mesmo em funções aninhadas
    await updateInventory(order);
    await sendNotification(order);

    return order;
  });
}

// Funções aninhadas acessam o mesmo contexto
async function updateInventory(order: Order) {
  const db = getTenantDb(); // Mesmo tenant, sem passar como parâmetro
  await db.update(inventory).set({ ... });
}
```

---

## 3. Migrations Paralelas por Tenant

### CLI Commands

```bash
# Gerar migration (igual ao drizzle-kit)
npx drizzle-multitenant generate --name=add-user-avatar

# Aplicar em TODOS os tenants (paralelo)
npx drizzle-multitenant migrate --all --concurrency=10

# Aplicar em tenants específicos
npx drizzle-multitenant migrate --tenants=tenant-1,tenant-2,tenant-3

# Aplicar em um tenant específico
npx drizzle-multitenant migrate --tenant=tenant-uuid

# Dry-run (mostra o que seria aplicado)
npx drizzle-multitenant migrate --all --dry-run

# Status de migrations por tenant
npx drizzle-multitenant status

# Marcar como aplicada sem executar
npx drizzle-multitenant migrate --all --mark-applied

# Rollback (com confirmação)
npx drizzle-multitenant rollback --tenant=tenant-uuid --to=0005_migration
```

### Programmatic API

```typescript
import { createMigrator } from 'drizzle-multitenant';

const migrator = createMigrator({
  config: tenantConfig,
  migrationsFolder: './drizzle/tenant',

  // Descoberta de tenants
  tenantDiscovery: async () => {
    // Buscar todos os tenants ativos
    const result = await sharedDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.active, true));
    return result.map(t => t.id);
  },
});

// Migrar todos
const results = await migrator.migrateAll({
  concurrency: 10,
  onProgress: (tenantId, status) => {
    console.log(`${tenantId}: ${status}`);
  },
  onError: (tenantId, error) => {
    console.error(`${tenantId} failed:`, error);
    // return 'continue' | 'abort'
    return 'continue';
  },
});

// Resultado detalhado
console.log({
  total: results.total,
  succeeded: results.succeeded,
  failed: results.failed,
  skipped: results.skipped,
  details: results.details,
});
```

### Status Dashboard

```bash
$ npx drizzle-multitenant status

┌─────────────────────────────────────┬────────────┬─────────────────┬──────────┐
│ Tenant                              │ Applied    │ Pending         │ Status   │
├─────────────────────────────────────┼────────────┼─────────────────┼──────────┤
│ tenant_abc123                       │ 15         │ 0               │ ✅ OK    │
│ tenant_def456                       │ 15         │ 0               │ ✅ OK    │
│ tenant_ghi789                       │ 14         │ 1               │ ⚠️ Behind│
│ tenant_jkl012                       │ 12         │ 3               │ ⚠️ Behind│
└─────────────────────────────────────┴────────────┴─────────────────┴──────────┘

Pending migrations:
- 0015_add_user_preferences.sql (2 tenants)
- 0014_add_audit_log.sql (1 tenant)
- 0013_add_notifications.sql (1 tenant)

Run 'drizzle-multitenant migrate --all' to apply pending migrations.
```

### Hooks para Migrations

```typescript
const migrator = createMigrator({
  // ...config

  hooks: {
    // Antes de cada tenant
    beforeTenant: async (tenantId) => {
      await notifySlack(`Starting migration for ${tenantId}`);
    },

    // Após cada tenant
    afterTenant: async (tenantId, result) => {
      await updateMigrationLog(tenantId, result);
    },

    // Antes de cada migration
    beforeMigration: async (tenantId, migrationName) => {
      console.log(`${tenantId}: Applying ${migrationName}`);
    },

    // Após cada migration
    afterMigration: async (tenantId, migrationName, durationMs) => {
      await recordMetric('migration_duration', durationMs, { tenantId, migrationName });
    },
  },
});
```

---

## 4. Cross-Schema Queries Tipadas

### O Problema

Alguns dados são compartilhados (ex: workflow_steps, subscription_plans), outros são por tenant. Queries que juntam dados de ambos schemas perdem type-safety.

### Solução: Typed Cross-Schema Builder

```typescript
import { createCrossSchemaQuery } from 'drizzle-multitenant';

const query = createCrossSchemaQuery({
  tenantDb: tenants.getDb('tenant-uuid'),
  sharedDb: tenants.getSharedDb(),
});

// Query tipada que junta dados de tenant + shared
const ordersWithPlans = await query
  .from('tenant', orders)                          // orders do tenant
  .leftJoin('shared', subscriptionPlans,           // plans do shared
    eq(orders.planId, subscriptionPlans.id))
  .select({
    orderId: orders.id,
    orderValue: orders.value,
    planName: subscriptionPlans.name,              // Tipado corretamente
    planFeatures: subscriptionPlans.features,
  })
  .where(eq(orders.status, 'active'));

// TypeScript infere:
// ordersWithPlans: Array<{
//   orderId: string;
//   orderValue: number;
//   planName: string | null;
//   planFeatures: string[] | null;
// }>
```

### Helper para Pattern Comum (Tenant + Lookup Table)

```typescript
import { withSharedLookup } from 'drizzle-multitenant';

// Buscar pedidos com workflow steps (shared)
const ordersWithSteps = await withSharedLookup({
  tenantDb,
  sharedDb,
  tenantTable: pedidos,
  sharedTable: workflowSteps,
  foreignKey: 'workflowStepId',
  sharedFields: ['id', 'name', 'tipo', 'cor'],
});

// Resultado tipado com campos do shared table
```

### Raw SQL com Type Safety

```typescript
import { crossSchemaRaw } from 'drizzle-multitenant';

// Para queries complexas que precisam de SQL raw
const result = await crossSchemaRaw<{
  tenant_data: string;
  shared_data: number;
}>({
  tenantSchema: 'tenant_abc123',
  sharedSchema: 'public',
  sql: `
    SELECT
      t.name as tenant_data,
      s.count as shared_data
    FROM $tenant.users t
    JOIN $shared.stats s ON s.user_id = t.id
  `,
});
```

---

## 5. tenant.config.ts com Geração de Migrations

### Config File Completo

```typescript
// tenant.config.ts
import { defineConfig } from 'drizzle-multitenant';
import * as tenantSchema from './schemas/tenant';
import * as sharedSchema from './schemas/shared';

export default defineConfig({
  // Conexão (obrigatório)
  connection: {
    url: process.env.DATABASE_URL!,
    poolConfig: {
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  },

  // Isolamento (obrigatório)
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (tenantId) => `tenant_${tenantId.replace(/-/g, '_')}`,
    maxPools: 50,
    poolTtlMs: 60 * 60 * 1000,
  },

  // Schemas (obrigatório)
  schemas: {
    tenant: tenantSchema,
    shared: sharedSchema,
  },

  // Migrations (opcional, para CLI)
  migrations: {
    // Pasta para migrations de tenant
    tenantFolder: './drizzle/tenant',

    // Pasta para migrations do shared schema
    sharedFolder: './drizzle/shared',

    // Tabela de controle de migrations
    migrationsTable: '__drizzle_migrations',

    // Descoberta de tenants para migrate --all
    tenantDiscovery: async (sharedDb) => {
      const result = await sharedDb
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.active, true));
      return result.map(t => t.id);
    },
  },

  // Hooks (opcional)
  hooks: {
    onPoolCreated: (tenantId) => {},
    onPoolEvicted: (tenantId) => {},
    onError: (tenantId, error) => {},
  },

  // Métricas (opcional)
  metrics: {
    enabled: true,
    prefix: 'drizzle_multitenant',
    // Expõe: pool_count, pool_connections_active, pool_connections_idle, query_duration
  },
});
```

### Geração de Migrations

```bash
# Gera migration para tenant schema
npx drizzle-multitenant generate --type=tenant --name=add-user-avatar

# Gera migration para shared schema
npx drizzle-multitenant generate --type=shared --name=add-subscription-plans

# Gera ambos se houver mudanças detectadas
npx drizzle-multitenant generate --name=my-changes
```

### Scaffold de Novo Tenant

```bash
# Cria schema + aplica todas as migrations
npx drizzle-multitenant tenant:create --id=new-tenant-uuid

# Programaticamente
import { tenants } from './tenant.config';

await tenants.createTenant('new-tenant-uuid');
// 1. CREATE SCHEMA tenant_new_tenant_uuid
// 2. Apply all migrations from tenantFolder
// 3. Ready for use
```

### Drop Tenant

```bash
# Remove schema completamente (com confirmação)
npx drizzle-multitenant tenant:drop --id=tenant-uuid

# Force (sem confirmação)
npx drizzle-multitenant tenant:drop --id=tenant-uuid --force
```

---

## Estrutura do Package

```
drizzle-multitenant/
├── src/
│   ├── index.ts                    # Exports principais
│   ├── config.ts                   # defineConfig, tipo Config
│   ├── manager.ts                  # createTenantManager
│   ├── context.ts                  # createTenantContext (AsyncLocalStorage)
│   ├── pool.ts                     # PoolManager com LRU
│   ├── migrator.ts                 # Migration engine
│   ├── cross-schema.ts             # Cross-schema query builder
│   ├── cli/
│   │   ├── index.ts                # CLI entry point
│   │   ├── commands/
│   │   │   ├── generate.ts
│   │   │   ├── migrate.ts
│   │   │   ├── status.ts
│   │   │   ├── tenant-create.ts
│   │   │   └── tenant-drop.ts
│   │   └── utils/
│   │       ├── progress.ts         # Progress bars
│   │       └── table.ts            # ASCII tables
│   ├── integrations/
│   │   ├── express.ts              # Express middleware
│   │   ├── fastify.ts              # Fastify plugin
│   │   ├── nestjs/
│   │   │   ├── module.ts
│   │   │   ├── decorators.ts
│   │   │   └── providers.ts
│   │   └── hono.ts                 # Hono middleware
│   └── types.ts                    # TypeScript types
├── bin/
│   └── drizzle-multitenant.js      # CLI executable
├── package.json
├── tsconfig.json
├── README.md
├── CHANGELOG.md
└── LICENSE
```

---

## Dependências

```json
{
  "dependencies": {
    "drizzle-orm": "^0.30.0",
    "pg": "^8.11.0",
    "lru-cache": "^10.0.0",
    "commander": "^12.0.0",
    "cli-table3": "^0.6.0",
    "ora": "^8.0.0",
    "chalk": "^5.0.0"
  },
  "peerDependencies": {
    "drizzle-orm": ">=0.29.0",
    "pg": ">=8.0.0"
  },
  "optionalDependencies": {
    "@nestjs/common": ">=9.0.0",
    "express": ">=4.0.0",
    "fastify": ">=4.0.0",
    "hono": ">=4.0.0"
  }
}
```

---

## Roadmap de Implementação

### v0.1.0 - Core
- [x] `defineConfig` e tipos
- [x] `createTenantManager` com pool management
- [x] `getDb()` e `getSharedDb()`
- [x] Cleanup automático de pools
- [x] Testes unitários

### v0.2.0 - Context
- [x] `createTenantContext` com AsyncLocalStorage
- [x] Express middleware
- [x] Fastify plugin
- [x] Testes de integração

### v0.3.0 - Migrations
- [x] CLI base (generate, migrate, status)
- [x] Parallel migration engine
- [x] tenant:create e tenant:drop
- [x] Hooks de migration

### v0.4.0 - Cross-Schema
- [x] `createCrossSchemaQuery`
- [x] `withSharedLookup` helper
- [x] Type inference completo

### v0.5.0 - NestJS
- [x] `TenantModule.forRoot()`
- [x] `@InjectTenantDb()` decorator
- [x] `@InjectTenantContext()` decorator
- [x] Guards e interceptors

### v1.0.0 - Production Ready
- [ ] Documentação completa
- [ ] Exemplos de projetos
- [ ] Performance benchmarks
- [ ] Edge cases testados

---

## Diferenciadores vs Alternativas

| Feature | drizzle-multitenant | Prisma Multi-tenant | Manual |
|---------|---------------------|---------------------|--------|
| Pool management automático | ✅ | ❌ | ❌ |
| Cleanup com LRU | ✅ | ❌ | ❌ |
| AsyncLocalStorage context | ✅ | ❌ | ❌ |
| Migrations paralelas | ✅ | ❌ | ❌ |
| Cross-schema tipado | ✅ | ❌ | ❌ |
| NestJS integration | ✅ | ⚠️ Parcial | ❌ |
| CLI dedicada | ✅ | ❌ | ❌ |
| Zero config padrão | ✅ | ❌ | ❌ |

---

## Exemplo Completo: Setup de Projeto

```typescript
// 1. tenant.config.ts
import { defineConfig } from 'drizzle-multitenant';
import * as tenantSchema from './db/tenant-schema';
import * as sharedSchema from './db/shared-schema';

export default defineConfig({
  connection: { url: process.env.DATABASE_URL! },
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (id) => `tenant_${id.replace(/-/g, '_')}`,
  },
  schemas: { tenant: tenantSchema, shared: sharedSchema },
  migrations: {
    tenantFolder: './drizzle/tenant',
    sharedFolder: './drizzle/shared',
    tenantDiscovery: async (db) => {
      const result = await db.select({ id: companies.id }).from(companies);
      return result.map(c => c.id);
    },
  },
});

// 2. context.ts
import { createTenantContext, createTenantManager } from 'drizzle-multitenant';
import config from './tenant.config';

export const tenants = createTenantManager(config);
export const { runWithTenant, getTenantDb } = createTenantContext(tenants);

// 3. middleware.ts (Express)
import { createExpressMiddleware } from 'drizzle-multitenant/express';
import { tenants } from './context';

export const tenantMiddleware = createExpressMiddleware({
  manager: tenants,
  extractTenantId: (req) => req.params.tenantId,
});

// 4. routes.ts
import { getTenantDb } from './context';

app.get('/api/:tenantId/users', tenantMiddleware, async (req, res) => {
  const db = getTenantDb();
  const users = await db.select().from(schema.users);
  res.json(users);
});

// 5. CLI
// $ npx drizzle-multitenant migrate --all
// $ npx drizzle-multitenant status
```

---

## Próximos Passos

1. **Criar repositório** `github.com/primesys-org/drizzle-multitenant`
2. **Implementar v0.1.0** (core + pool management)
3. **Escrever testes** com Vitest
4. **Documentação** com VitePress
5. **Publicar npm** como `drizzle-multitenant`

---

## Decisões Finalizadas

| Decisão | Escolha |
|---------|---------|
| **Nome npm** | `drizzle-multitenant` |
| **Database inicial** | PostgreSQL only |
| **Licença** | MIT |
| **Organização** | Projeto independente (não @primesys) |

---

## Repositório

```
github.com/<seu-usuario>/drizzle-multitenant
├── README.md
├── LICENSE (MIT)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   └── ... (estrutura acima)
├── examples/
│   ├── express-basic/
│   ├── nestjs-complete/
│   └── standalone/
└── docs/
    ├── getting-started.md
    ├── configuration.md
    ├── migrations.md
    ├── context.md
    └── cross-schema.md
```
