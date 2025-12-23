# drizzle-multitenant - Roadmap

> Multi-tenancy toolkit for Drizzle ORM with schema isolation, tenant context, and parallel migrations.

---

## Versões Completas

### v0.1.0 - Core
- [x] `defineConfig` e tipos
- [x] `createTenantManager` com pool management
- [x] `getDb()` e `getSharedDb()`
- [x] Cleanup automático de pools (LRU)
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
- [x] Documentação completa (README.md)
- [x] Package publicado no npm
- [x] 148 testes passando
- [x] Licença MIT

---

## Próximas Versões

### v1.1.0 - Resiliência e Observabilidade

#### Retry Logic para Conexões
Conexões podem falhar temporariamente. Adicionar retry automático com backoff exponencial.

```typescript
import { defineConfig } from 'drizzle-multitenant';

export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    },
  },
  // ...
});
```

#### Health Checks
Verificar saúde dos pools e conexões.

```typescript
const manager = createTenantManager(config);

// Verificar saúde de todos os pools
const health = await manager.healthCheck();
// {
//   healthy: true,
//   pools: [
//     { tenantId: 'abc', status: 'ok', connections: 5 },
//     { tenantId: 'def', status: 'degraded', connections: 1 },
//   ],
//   sharedDb: 'ok',
//   timestamp: '2024-01-15T10:30:00Z'
// }

// Endpoint para load balancers
app.get('/health', async (req, res) => {
  const health = await manager.healthCheck();
  res.status(health.healthy ? 200 : 503).json(health);
});
```

#### Métricas Prometheus
Expor métricas no formato Prometheus para monitoramento.

```typescript
import { defineConfig } from 'drizzle-multitenant';

export default defineConfig({
  // ...
  metrics: {
    enabled: true,
    prefix: 'drizzle_multitenant',
  },
});

// Endpoint para Prometheus
app.get('/metrics', async (req, res) => {
  const metrics = manager.getMetrics();
  res.set('Content-Type', 'text/plain');
  res.send(metrics);
});
```

Métricas expostas:
```
drizzle_multitenant_pool_count 15
drizzle_multitenant_pool_connections_active{tenant="abc"} 3
drizzle_multitenant_pool_connections_idle{tenant="abc"} 7
drizzle_multitenant_query_duration_seconds_bucket{le="0.1"} 1024
drizzle_multitenant_pool_evictions_total 42
drizzle_multitenant_errors_total{type="connection"} 3
```

#### Structured Logging
Integração com loggers populares (pino, winston).

```typescript
import pino from 'pino';

const logger = pino({ level: 'info' });

export default defineConfig({
  // ...
  hooks: {
    logger: {
      provider: logger,
      level: 'info',
      // Logs estruturados automaticamente
      // { tenant: 'abc', event: 'pool_created', duration: 45 }
    },
    onPoolCreated: (tenantId) => {
      logger.info({ tenant: tenantId }, 'Pool created');
    },
  },
});
```

**Checklist v1.1.0:**
- [ ] Retry logic com backoff exponencial
- [ ] `manager.healthCheck()` API
- [ ] Métricas Prometheus
- [ ] Integração com pino/winston
- [ ] Testes unitários e integração

---

### v1.2.0 - Segurança

#### Schema Name Sanitization
Validar e sanitizar nomes de schema para prevenir SQL injection.

```typescript
import { defineConfig } from 'drizzle-multitenant';

export default defineConfig({
  isolation: {
    strategy: 'schema',
    schemaNameTemplate: (tenantId) => `tenant_${tenantId}`,
    // Sanitização automática habilitada por padrão
    sanitize: {
      enabled: true,
      maxLength: 63, // Limite PostgreSQL
      allowedChars: /^[a-z0-9_]+$/,
      reservedNames: ['public', 'pg_catalog', 'information_schema'],
    },
  },
});

// Throws error se nome inválido
manager.getDb('tenant; DROP TABLE users;--'); // Error: Invalid tenant ID
```

#### Rate Limiting por Tenant
Limitar queries por tenant para prevenir abuso.

```typescript
export default defineConfig({
  // ...
  rateLimit: {
    enabled: true,
    maxQueriesPerSecond: 100,
    maxConnectionsPerTenant: 5,
    onLimitExceeded: (tenantId, limit) => {
      logger.warn({ tenant: tenantId, limit }, 'Rate limit exceeded');
      // 'throttle' | 'reject' | 'queue'
      return 'throttle';
    },
  },
});
```

#### Tenant Isolation Audit
Auditoria para garantir isolamento entre tenants.

```typescript
export default defineConfig({
  // ...
  audit: {
    enabled: true,
    logQueries: true,
    detectCrossSchemaAccess: true,
    onViolation: async (event) => {
      // {
      //   type: 'cross_schema_access',
      //   tenant: 'abc',
      //   query: 'SELECT * FROM tenant_def.users',
      //   timestamp: Date
      // }
      await sendAlert(event);
    },
  },
});
```

**Checklist v1.2.0:**
- [ ] Schema name sanitization
- [ ] Rate limiting por tenant
- [ ] Audit logging
- [ ] Detecção de cross-schema access
- [ ] Testes de segurança

---

### v1.3.0 - Performance

#### Connection Queue
Gerenciar overflow de pools com queue de espera.

```typescript
export default defineConfig({
  isolation: {
    maxPools: 50,
    pooling: {
      strategy: 'queue', // 'queue' | 'reject' | 'evict-lru'
      queueTimeout: 5000,
      maxWaitingRequests: 100,
    },
  },
});

// Eventos de queue
hooks: {
  onQueueFull: (tenantId) => {
    logger.warn({ tenant: tenantId }, 'Connection queue full');
  },
  onQueueTimeout: (tenantId, waitTime) => {
    logger.error({ tenant: tenantId, waitTime }, 'Queue timeout');
  },
}
```

#### Query Caching
Cache opcional para queries repetidas.

```typescript
import { createTenantManager } from 'drizzle-multitenant';
import Redis from 'ioredis';

const redis = new Redis();

const manager = createTenantManager({
  ...config,
  cache: {
    enabled: true,
    provider: redis, // ou 'memory'
    defaultTtlMs: 60000,
    maxSize: 10000, // para memory provider
    keyPrefix: 'dmt:',
  },
});

// Uso no código
const db = manager.getDb('tenant-123');

// Query com cache
const users = await db
  .select()
  .from(schema.users)
  .where(eq(schema.users.active, true))
  .$cache({ ttl: 5000, key: 'active-users' });

// Invalidar cache
await manager.invalidateCache('tenant-123', 'active-users');
await manager.invalidateTenantCache('tenant-123'); // todo cache do tenant
```

#### Prepared Statements Pool
Reutilizar prepared statements entre requests.

```typescript
export default defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    preparedStatements: {
      enabled: true,
      maxPerTenant: 100,
      ttlMs: 3600000, // 1 hora
    },
  },
});
```

**Checklist v1.3.0:**
- [ ] Connection queue com timeout
- [ ] Query caching (memory + Redis)
- [ ] Cache invalidation API
- [ ] Prepared statements pool
- [ ] Benchmarks de performance

---

### v1.4.0 - Novas Estratégias de Isolamento

#### Row-Level Security (RLS)
Isolamento por linha usando RLS do PostgreSQL.

```typescript
export default defineConfig({
  isolation: {
    strategy: 'row',
    tenantColumn: 'tenant_id',
    enableRLS: true,
  },
  schemas: {
    tenant: tenantSchema,
  },
});

// Gera automaticamente:
// CREATE POLICY tenant_isolation ON users
//   USING (tenant_id = current_setting('app.tenant_id')::uuid);

// Uso transparente
const db = manager.getDb('tenant-123');
const users = await db.select().from(schema.users);
// WHERE tenant_id = 'tenant-123' aplicado automaticamente
```

#### Database-per-Tenant
Isolamento completo por database.

```typescript
export default defineConfig({
  isolation: {
    strategy: 'database',
    databaseNameTemplate: (tenantId) => `db_${tenantId}`,
    createDatabase: true, // criar automaticamente
  },
});

// Cada tenant tem seu próprio database
// db_tenant_abc, db_tenant_def, etc.
```

#### Hybrid Strategy
Combinar estratégias para diferentes tiers de tenants.

```typescript
export default defineConfig({
  isolation: {
    strategy: 'hybrid',
    default: 'row', // tenants pequenos
    rules: [
      {
        condition: async (tenantId) => {
          const plan = await getTenantPlan(tenantId);
          return plan === 'enterprise';
        },
        strategy: 'schema', // tenants enterprise
      },
      {
        condition: async (tenantId) => {
          const rows = await getTenantRowCount(tenantId);
          return rows > 100000;
        },
        strategy: 'schema', // tenants grandes
      },
    ],
    onPromotion: async (tenantId, from, to) => {
      // Migrar dados de RLS para schema dedicado
      await migrateDataToSchema(tenantId);
      logger.info({ tenant: tenantId, from, to }, 'Tenant promoted');
    },
  },
});
```

**Checklist v1.4.0:**
- [ ] Row-Level Security (RLS)
- [ ] Geração automática de policies
- [ ] Database-per-tenant strategy
- [ ] Hybrid strategy com regras
- [ ] Migração entre estratégias

---

### v1.5.0 - Developer Experience

#### CLI Interativo
Modo interativo para operações comuns.

```bash
$ npx drizzle-multitenant

? What do you want to do? (Use arrow keys)
❯ Migrate all tenants
  Check migration status
  Create new tenant
  Drop tenant
  View pool statistics
  Generate migration
  Exit

? Select tenants to migrate:
  [x] tenant_abc (2 pending)
  [x] tenant_def (2 pending)
  [ ] tenant_ghi (up to date)
```

#### Tenant Seeding
Popular dados iniciais em tenants.

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

```bash
# CLI
npx drizzle-multitenant seed --tenant=abc --file=./seeds/initial.ts
npx drizzle-multitenant seed --all --file=./seeds/initial.ts

# Programático
await migrator.seedTenant('abc', seed);
await migrator.seedAll(seed, { concurrency: 10 });
```

#### Schema Drift Detection
Detectar divergências entre schema esperado e atual.

```bash
$ npx drizzle-multitenant diff --tenant=abc

Schema drift detected in tenant_abc:

  Missing columns:
    - users.avatar_url (varchar)
    - users.last_login (timestamp)

  Extra columns:
    - users.legacy_field (will be removed)

  Index differences:
    - Missing: idx_users_email
    - Extra: idx_legacy_lookup

Run 'drizzle-multitenant migrate --tenant=abc' to fix.
```

#### Tenant Cloning
Clonar tenant para desenvolvimento/teste.

```bash
# CLI
npx drizzle-multitenant tenant:clone \
  --from=production-tenant \
  --to=dev-tenant \
  --include-data \
  --anonymize  # GDPR compliance
```

```typescript
// Programático
await migrator.cloneTenant('source', 'target', {
  includeData: true,
  anonymize: {
    enabled: true,
    rules: {
      users: {
        email: (val) => `user-${hash(val)}@example.com`,
        name: () => faker.person.fullName(),
        phone: () => null,
      },
    },
  },
});
```

**Checklist v1.5.0:**
- [ ] CLI interativo com inquirer
- [ ] Tenant seeding API
- [ ] Schema drift detection
- [ ] Tenant cloning com anonymization
- [ ] Documentação interativa

---

### v1.6.0 - Integrações Avançadas

#### tRPC Integration
Middleware para tRPC.

```typescript
import { initTRPC } from '@trpc/server';
import { createTRPCMiddleware } from 'drizzle-multitenant/trpc';

const t = initTRPC.context<Context>().create();

const tenantMiddleware = createTRPCMiddleware({
  manager,
  extractTenantId: (ctx) => ctx.req.headers['x-tenant-id'],
});

export const protectedProcedure = t.procedure.use(tenantMiddleware);

// Uso
export const userRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    // ctx.tenantDb já configurado
    return ctx.tenantDb.select().from(users);
  }),
});
```

#### GraphQL Context
Integração com Apollo Server e GraphQL Yoga.

```typescript
import { ApolloServer } from '@apollo/server';
import { createGraphQLContext } from 'drizzle-multitenant/graphql';

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

const { url } = await startStandaloneServer(server, {
  context: createGraphQLContext({
    manager,
    extractTenantId: (req) => req.headers['x-tenant-id'],
  }),
});

// Nos resolvers
const resolvers = {
  Query: {
    users: async (_, __, { tenantDb }) => {
      return tenantDb.select().from(users);
    },
  },
};
```

#### BullMQ Integration
Contexto de tenant em jobs de background.

```typescript
import { Queue, Worker } from 'bullmq';
import { createBullMQPlugin } from 'drizzle-multitenant/bullmq';

const queue = new Queue('emails');

// Job sempre inclui tenantId
await queue.add('send-welcome', {
  tenantId: 'abc', // obrigatório
  userId: '123',
});

// Worker com contexto automático
const worker = new Worker(
  'emails',
  async (job) => {
    // tenantDb configurado automaticamente via job.data.tenantId
    const { tenantDb } = job;
    const user = await tenantDb
      .select()
      .from(users)
      .where(eq(users.id, job.data.userId));

    await sendEmail(user.email);
  },
  {
    plugins: [createBullMQPlugin({ manager })],
  }
);
```

**Checklist v1.6.0:**
- [ ] tRPC middleware
- [ ] Apollo Server context
- [ ] GraphQL Yoga context
- [ ] BullMQ plugin
- [ ] Exemplos e documentação

---

### v2.0.0 - Enterprise Features

#### Multi-Region Support
Suporte para tenants em diferentes regiões.

```typescript
export default defineConfig({
  regions: {
    'us-east': {
      url: process.env.US_EAST_DB_URL!,
      default: true,
    },
    'eu-west': {
      url: process.env.EU_WEST_DB_URL!,
    },
    'ap-south': {
      url: process.env.AP_SOUTH_DB_URL!,
    },
  },
  tenantRegion: async (tenantId) => {
    const tenant = await getTenant(tenantId);
    return tenant.region; // 'us-east' | 'eu-west' | 'ap-south'
  },
});

// Transparente para o código
const db = manager.getDb('tenant-123'); // conecta na região correta
```

#### Backup & Restore
Backup e restore por tenant.

```typescript
// Backup
await migrator.backupTenant('abc', {
  output: './backups/abc-2024-01-15.sql',
  format: 'sql', // 'sql' | 'custom' | 'directory'
  compress: true,
});

// Backup para S3
await migrator.backupTenant('abc', {
  output: 's3://my-bucket/backups/abc.sql.gz',
  s3: { region: 'us-east-1' },
});

// Restore
await migrator.restoreTenant('abc', {
  input: './backups/abc-2024-01-15.sql',
  dropExisting: true,
});

// Restore para novo tenant
await migrator.restoreTenant('abc-copy', {
  input: './backups/abc-2024-01-15.sql',
  createSchema: true,
});
```

#### Tenant Quotas
Limites de recursos por tenant.

```typescript
export default defineConfig({
  quotas: {
    enabled: true,
    defaults: {
      maxRows: 1000000,
      maxStorageMb: 1024,
      maxTablesRows: {
        users: 10000,
        logs: 100000,
      },
    },
    perTenant: async (tenantId) => {
      const plan = await getTenantPlan(tenantId);
      return quotasByPlan[plan];
    },
    onQuotaExceeded: async (tenantId, quota, current) => {
      // 'warn' | 'block' | 'notify'
      await notifyTenantAdmin(tenantId, quota);
      return 'warn';
    },
  },
});
```

#### Encryption at Rest
Criptografia de colunas sensíveis.

```typescript
export default defineConfig({
  encryption: {
    enabled: true,
    keyProvider: {
      type: 'aws-kms',
      keyId: process.env.KMS_KEY_ID!,
      region: 'us-east-1',
    },
    // ou
    keyProvider: {
      type: 'vault',
      url: process.env.VAULT_URL!,
      token: process.env.VAULT_TOKEN!,
    },
    columns: [
      'users.ssn',
      'users.tax_id',
      'payments.card_number',
      'payments.cvv',
    ],
  },
});

// Transparente para o código
const user = await db.select().from(users).where(eq(users.id, '123'));
// user.ssn já descriptografado
```

#### Cross-Tenant Admin Queries
Queries agregadas para dashboards administrativos.

```typescript
import { createAdminQuery } from 'drizzle-multitenant';

const adminQuery = createAdminQuery({ manager });

// Agregação cross-tenant
const stats = await adminQuery
  .fromAllTenants(users)
  .select({
    tenantId: sql`current_schema()`,
    count: count(),
    activeUsers: count(sql`CASE WHEN active THEN 1 END`),
  })
  .groupBy(sql`current_schema()`);

// Resultado:
// [
//   { tenantId: 'tenant_abc', count: 1500, activeUsers: 1200 },
//   { tenantId: 'tenant_def', count: 3000, activeUsers: 2800 },
// ]
```

**Checklist v2.0.0:**
- [ ] Multi-region support
- [ ] Backup/Restore API
- [ ] S3 integration
- [ ] Tenant quotas
- [ ] Column encryption (KMS/Vault)
- [ ] Cross-tenant admin queries
- [ ] Breaking changes migration guide

---

## Priorização

| Versão | Tema | Impacto | Esforço | ETA |
|--------|------|---------|---------|-----|
| v1.1.0 | Resiliência | Alto | Médio | - |
| v1.2.0 | Segurança | Alto | Médio | - |
| v1.3.0 | Performance | Médio | Alto | - |
| v1.4.0 | Estratégias | Alto | Alto | - |
| v1.5.0 | DX | Médio | Médio | - |
| v1.6.0 | Integrações | Médio | Médio | - |
| v2.0.0 | Enterprise | Alto | Muito Alto | - |

---

## Quick Wins (Podem entrar em qualquer versão)

| Feature | Esforço | Versão |
|---------|---------|--------|
| Health check API | 2h | v1.1.0 |
| Schema name sanitization | 1h | v1.2.0 |
| CLI interativo básico | 4h | v1.5.0 |
| Structured logging hook | 2h | v1.1.0 |
| Tenant clone (schema only) | 4h | v1.5.0 |

---

## Breaking Changes Planejados (v2.0.0)

1. **Namespace de hooks**: Mover hooks para objeto dedicado
2. **Métricas opt-out**: Métricas habilitadas por padrão
3. **Config validation**: Validação mais estrita em runtime
4. **Import paths**: Consolidar exports

```typescript
// v1.x
import { createTenantManager } from 'drizzle-multitenant';
import { createExpressMiddleware } from 'drizzle-multitenant/express';

// v2.0 (proposta)
import {
  createTenantManager,
  createExpressMiddleware,
  createFastifyPlugin,
} from 'drizzle-multitenant';
```
