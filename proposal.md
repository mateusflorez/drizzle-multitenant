# Proposal: Shared Schema Management Enhancement

**Date:** 2025-12-25
**Status:** In Progress
**Author:** Auto-generated proposal
**Last Updated:** 2025-12-25

---

## Executive Summary

Expandir o `drizzle-multitenant` para incluir gerenciamento completo de **shared schemas**, transformando-o no toolkit definitivo para multi-tenancy com Drizzle ORM. O foco é preencher gaps não atendidos pelo ecossistema atual.

---

## Análise do Estado Atual

### O que já existe no projeto

| Feature | Status | Localização |
|---------|--------|-------------|
| Tenant migrations | Completo | `src/migrator/` |
| Tenant seeding | Completo | `src/cli/commands/seed.ts` |
| Health checks | Completo | `src/pool/health/` |
| Cross-schema queries | Completo | `src/cross-schema/` |
| Init wizard | Básico | `src/cli/commands/init.ts` |
| Drift detection | Completo | `src/migrator/drift/` |
| CLI interativa | Completo | `src/cli/ui/` |

### Gaps identificados

1. ~~**Shared schema migrations** - Não há suporte para migrar o schema `public`~~ ✅ **Implementado**
2. ~~**Shared schema seeding** - Seeds só funcionam para tenants~~ ✅ **Implementado**
3. **Project scaffolding** - Sem geração de boilerplate
4. **Schema validation** - Sem linting ou validação de convenções
5. **Init wizard limitado** - Não gera estrutura de pastas completa
6. **Sem templates de projeto** - Usuário começa do zero

---

## Propostas de Features

### 1. Shared Schema Migrations ✅ IMPLEMENTADO

**Problema:** Tabelas compartilhadas (plans, roles, permissions) não têm suporte de migração.

**Solução:**

```bash
# Estrutura de pastas
drizzle/
├── tenant-migrations/     # Migrações de tenant (já existe)
│   ├── 0001_create_users.sql
│   └── 0002_add_profiles.sql
├── shared-migrations/     # NOVO: Migrações do schema public
│   ├── 0001_create_plans.sql
│   └── 0002_create_roles.sql
└── seeds/
    ├── tenant/
    └── shared/
```

**CLI Commands:**

```bash
# Gerar migração para shared schema
npx drizzle-multitenant generate:shared --name=add-plans

# Aplicar migrações do shared schema
npx drizzle-multitenant migrate:shared

# Status unificado
npx drizzle-multitenant status --include-shared
```

**API Programática:**

```typescript
import { createMigrator } from 'drizzle-multitenant/migrator';

const migrator = createMigrator(config, {
  // Tenant migrations (já existe)
  migrationsFolder: './drizzle/tenant-migrations',

  // NOVO: Shared migrations
  sharedMigrationsFolder: './drizzle/shared-migrations',
});

// Migrar shared primeiro, depois tenants
await migrator.migrateShared();
await migrator.migrateAll({ concurrency: 10 });
```

**Configuração:**

```typescript
// tenant.config.ts
export default defineConfig({
  // ... existing config

  migrations: {
    folder: './drizzle/tenant-migrations',
    sharedFolder: './drizzle/shared-migrations', // NOVO
    table: '__drizzle_migrations',
    sharedTable: '__drizzle_shared_migrations', // NOVO
  },
});
```

---

### 2. Shared Schema Seeding ✅ IMPLEMENTADO

**Problema:** Dados iniciais compartilhados (planos, roles padrão) precisam de setup manual.

**Solução:**

```typescript
// seeds/shared/plans.ts
import { SeedFunction } from 'drizzle-multitenant';

export const seed: SeedFunction = async (db) => {
  await db.insert(plans).values([
    { id: 'free', name: 'Free', price: 0 },
    { id: 'pro', name: 'Pro', price: 29 },
    { id: 'enterprise', name: 'Enterprise', price: 99 },
  ]).onConflictDoNothing();
};
```

**CLI:**

```bash
# Seed do shared schema
npx drizzle-multitenant seed:shared --file=./seeds/shared/plans.ts

# Seed completo (shared + tenants)
npx drizzle-multitenant seed:all \
  --shared-file=./seeds/shared/plans.ts \
  --tenant-file=./seeds/tenant/initial.ts
```

---

### 3. Enhanced Init Wizard ✅ IMPLEMENTADO

**Problema:** O init atual gera apenas config, sem estrutura de projeto.

**Solução expandida:**

```bash
npx drizzle-multitenant init --template=full
```

**Wizard interativo melhorado:**

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

**Estrutura gerada (template: full):**

```
project/
├── tenant.config.ts
├── docker-compose.yml              # NOVO
├── drizzle/
│   ├── tenant-migrations/
│   │   └── .gitkeep
│   ├── shared-migrations/          # NOVO
│   │   └── .gitkeep
│   └── seeds/
│       ├── tenant/
│       │   └── initial.ts          # NOVO: Example seed
│       └── shared/
│           └── plans.ts            # NOVO: Example seed
├── src/
│   └── db/
│       ├── schema/
│       │   ├── tenant/
│       │   │   └── users.ts        # NOVO: Example schema
│       │   └── shared/
│       │       └── plans.ts        # NOVO: Example schema
│       └── index.ts                # NOVO: DB setup
└── .env.example                    # NOVO
```

---

### 4. Scaffold Command

**Problema:** Criar novos componentes requer copiar/colar código boilerplate.

**Solução:**

```bash
# Gerar schema de tenant
npx drizzle-multitenant scaffold:schema orders --type=tenant
# Cria: src/db/schema/tenant/orders.ts

# Gerar schema compartilhado
npx drizzle-multitenant scaffold:schema plans --type=shared
# Cria: src/db/schema/shared/plans.ts

# Gerar seed
npx drizzle-multitenant scaffold:seed initial --type=tenant
# Cria: drizzle/seeds/tenant/initial.ts

# Gerar migração com template
npx drizzle-multitenant scaffold:migration add-orders --type=tenant
# Abre editor com template SQL
```

**Templates gerados:**

```typescript
// src/db/schema/tenant/orders.ts (gerado)
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

// Indexes
export const ordersIndexes = {
  userIdIdx: index('orders_user_id_idx').on(orders.userId),
  statusIdx: index('orders_status_idx').on(orders.status),
};
```

---

### 5. Schema Validation & Linting

**Problema:** Inconsistências entre schemas de tenants e convenções não seguidas.

**Solução:**

```bash
# Validar schemas
npx drizzle-multitenant lint

# Output:
# ⚠ tenant/users.ts: Missing 'updatedAt' column (convention)
# ⚠ tenant/orders.ts: Missing index on foreign key 'userId'
# ✗ shared/plans.ts: Using 'serial' instead of 'uuid' for primary key
# ✓ 12 schemas validated, 2 warnings, 1 error
```

**Regras configuráveis:**

```typescript
// tenant.config.ts
export default defineConfig({
  // ...

  lint: {
    rules: {
      // Convenções de naming
      'table-naming': ['error', { style: 'snake_case' }],
      'column-naming': ['error', { style: 'snake_case' }],

      // Boas práticas
      'require-primary-key': 'error',
      'prefer-uuid-pk': 'warn',
      'require-timestamps': 'warn',
      'index-foreign-keys': 'warn',

      // Segurança
      'no-cascade-delete': 'warn',
      'require-soft-delete': 'off',
    },
  },
});
```

**Integração CI:**

```yaml
# .github/workflows/lint.yml
- name: Lint database schemas
  run: npx drizzle-multitenant lint --format=github
```

---

### 6. Doctor Command

**Problema:** Troubleshooting de problemas de configuração é manual.

**Solução:**

```bash
npx drizzle-multitenant doctor

# Output:
# 🔍 Checking drizzle-multitenant configuration...
#
# ✓ Configuration file found: tenant.config.ts
# ✓ Database connection: OK (PostgreSQL 15.4)
# ✓ Tenant discovery: Found 42 tenants
# ✓ Migrations folder: ./drizzle/tenant-migrations (12 files)
# ⚠ Shared migrations folder: Not configured
# ✓ Schema isolation: schema-based
# ✓ Pool configuration: max=10, ttl=3600000ms
#
# ⚠ Recommendations:
#   1. Configure sharedFolder for shared schema migrations
#   2. Consider increasing maxPools (current: 50, tenants: 42)
#
# 📊 Health Summary:
#   Pools: 5 active, 0 degraded, 0 unhealthy
#   Shared DB: OK (12ms latency)
```

---

### 7. Interactive UI Enhancements ✅ IMPLEMENTADO (Parcial)

**Problema:** A UI interativa não cobre shared schemas.

**Solução:** Adicionar telas para shared schema management.

```
┌─────────────────────────────────────────────────────────┐
│  drizzle-multitenant v1.3.0                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ❯ 1. Tenant Migrations                                 │
│    2. Shared Migrations          ← NOVO                 │
│    3. Tenant Status                                     │
│    4. Shared Status              ← NOVO                 │
│    5. Seeding                                           │
│    6. Health Check                                      │
│    7. Generate Migration                                │
│    8. Schema Lint                ← NOVO                 │
│    9. Doctor                     ← NOVO                 │
│    0. Exit                                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

### 8. Export/Import Schemas

**Problema:** Compartilhar definições de schema entre projetos é difícil.

**Solução:**

```bash
# Exportar schemas como JSON Schema
npx drizzle-multitenant export --format=json > schemas.json

# Exportar como TypeScript types
npx drizzle-multitenant export --format=typescript > schemas.d.ts

# Exportar como diagrama ERD (Mermaid)
npx drizzle-multitenant export --format=mermaid > erd.md

# Importar schema de outro projeto
npx drizzle-multitenant import --from=./other-project/schemas.json
```

---

## Priorização

### Phase 1: Core Shared Schema (v1.3.0)
- [x] Shared schema migrations ✅
- [x] Shared schema seeding ✅
- [x] Enhanced init wizard ✅
- [ ] Doctor command

### Phase 2: Developer Experience (v1.4.0)
- [ ] Scaffold command
- [ ] Schema linting
- [x] Interactive UI enhancements (shared migrations) ✅

### Phase 3: Advanced Features (v1.5.0)
- [ ] Export/Import schemas
- [ ] CI/CD templates
- [ ] Metrics dashboard integration

---

## Implementação Técnica

### Estrutura de arquivos proposta

```
src/
├── migrator/
│   └── shared/                      # ✅ IMPLEMENTADO
│       ├── index.ts
│       ├── shared-migration-executor.ts
│       └── types.ts
│   └── seed/
│       ├── shared-seeder.ts         # ✅ IMPLEMENTADO
│       └── shared-seeder.test.ts    # ✅ IMPLEMENTADO
├── cli/
│   ├── commands/
│   │   ├── init.ts                  # ✅ IMPLEMENTADO (enhanced wizard)
│   │   ├── generate-shared.ts       # ✅ IMPLEMENTADO
│   │   ├── migrate-shared.ts        # ✅ IMPLEMENTADO
│   │   ├── seed-shared.ts           # ✅ IMPLEMENTADO
│   │   ├── seed-all.ts              # ✅ IMPLEMENTADO
│   │   ├── scaffold.ts              # PENDENTE
│   │   ├── lint.ts                  # PENDENTE
│   │   ├── doctor.ts                # PENDENTE
│   │   └── export.ts                # PENDENTE
│   ├── init/                        # ✅ IMPLEMENTADO (enhanced wizard)
│   │   ├── index.ts
│   │   ├── types.ts
│   │   └── generators/
│   │       ├── index.ts
│   │       ├── config-generator.ts
│   │       ├── structure-generator.ts
│   │       ├── docker-generator.ts
│   │       └── framework-generator.ts
│   └── ui/
│       └── screens/
│           ├── seeding-screen.ts    # ✅ ATUALIZADO (shared seeding support)
│           └── lint-screen.ts       # PENDENTE
├── lint/                            # PENDENTE
│   ├── index.ts
│   ├── rules/
│   │   ├── naming.ts
│   │   ├── conventions.ts
│   │   └── security.ts
│   └── reporter.ts
└── scaffold/                        # PENDENTE
    ├── index.ts
    ├── templates/
    │   ├── schema.ts.hbs
    │   ├── seed.ts.hbs
    │   └── migration.sql.hbs
    └── generator.ts
```

### Breaking Changes

**Nenhum.** Todas as features são aditivas e opcionais.

### Backward Compatibility

- Configuração existente continua funcionando
- Novos campos são opcionais
- CLI mantém comandos atuais

---

## Considerações

### Vantagens

1. **Diferenciação** - Nenhum pacote oferece esse conjunto de features
2. **Completude** - Cobre todo o ciclo de vida de multi-tenancy
3. **DX** - Reduz boilerplate e erros comuns
4. **Adoção** - Facilita onboarding de novos projetos

### Riscos

1. **Escopo** - Features demais podem diluir o foco
2. **Manutenção** - Mais código = mais bugs potenciais
3. **Complexidade** - Pode intimidar usuários simples

### Mitigações

1. Manter features como opt-in
2. Documentação clara de cada feature
3. Templates para diferentes níveis de complexidade

---

## Próximos Passos

1. [ ] Validar proposta com usuários (GitHub Discussions)
2. [x] Priorizar Phase 1 features ✅
3. [ ] Criar issues detalhadas para cada feature
4. [x] Começar implementação do shared migrations ✅

---

## Changelog

### 2025-12-25 (Enhanced Init Wizard)
- ✅ Implementado wizard interativo melhorado em `src/cli/commands/init.ts`
- ✅ Adicionado suporte a 4 templates de projeto: Minimal, Standard, Full, Enterprise
- ✅ Adicionado suporte a integração com frameworks: Express, Fastify, NestJS, Hono
- ✅ Implementado seletor de features (shared schema, cross-schema, health checks, etc.)
- ✅ Implementado gerador de docker-compose.yml
- ✅ Implementado gerador de estrutura de pastas completa
- ✅ Implementado gerador de schemas de exemplo (tenant e shared)
- ✅ Implementado gerador de seeds de exemplo
- ✅ Implementado gerador de arquivos CI/CD para template Enterprise
- ✅ Adicionado módulo `src/cli/init/` com tipos e geradores
- ✅ Adicionados 54 testes unitários para os geradores
- ✅ Todos os testes passando

### 2025-12-25 (Shared Schema Seeding)
- ✅ Implementado `SharedSeeder` em `src/migrator/seed/shared-seeder.ts`
- ✅ Implementado comando CLI `seed-shared`
- ✅ Implementado comando CLI `seed-all` (shared + tenants)
- ✅ Atualizado `SeedingScreen` na UI interativa com suporte a shared seeding
- ✅ Adicionado método `seedShared()` no Migrator
- ✅ Adicionado método `seedAllWithShared()` no Migrator
- ✅ Adicionado método `hasSharedSeeding()` no Migrator
- ✅ Adicionada interface `ISharedSeeder` em interfaces.ts
- ✅ Exportados tipos `SharedSeedFunction` e `SharedSeedResult`
- ✅ Todos os 684 testes passando

### 2025-12-25 (Shared Schema Migrations)
- ✅ Implementado `SharedMigrationExecutor` em `src/migrator/shared/`
- ✅ Implementado comando CLI `migrate:shared`
- ✅ Implementado comando CLI `generate:shared`
- ✅ Integrado shared migrations na UI interativa
- ✅ Adicionado suporte a `sharedMigrationsFolder` no `MigratorConfig`
- ✅ Adicionado método `migrateShared()` no Migrator
- ✅ Adicionado método `getSharedStatus()` no Migrator
- ✅ Adicionado método `migrateAllWithShared()` no Migrator
- ✅ Todos os 674 testes passando

---

## Referências

- [Drizzle Kit Documentation](https://orm.drizzle.team/docs/kit-overview)
- [Atlas + Drizzle Integration](https://atlasgo.io/guides/orms/drizzle/getting-started)
- [Multi-tenancy Patterns](https://docs.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models)
