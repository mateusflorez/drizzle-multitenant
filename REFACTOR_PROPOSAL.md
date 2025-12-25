# Proposta de Refatoração: God Components

> **Criado em:** 2025-12-25
> **Status:** Draft
> **Impacto:** Alto (breaking changes em APIs internas)

## Resumo Executivo

O codebase possui **3 god components** com mais de 500 linhas que violam o Single Responsibility Principle:

| Arquivo | Linhas | Métodos | Severidade |
|---------|--------|---------|------------|
| `migrator/migrator.ts` | 2,085 | 122+ | CRÍTICO |
| `pool.ts` | 867 | 60+ | ALTO |
| `cli/ui/menu.ts` | 790 | 13+ | ALTO |

**Total:** 3,742 linhas concentradas em 3 arquivos que precisam de refatoração.

---

## 1. Migrator (2,085 linhas) - CRÍTICO

### Problema

A classe `Migrator` é monolítica com 122+ métodos que cobrem responsabilidades distintas:

- Execução de migrações (paralela e individual)
- Sincronização de divergências (disk vs database)
- Detecção de schema drift
- Seeding de dados
- Gerenciamento de schemas (criar/dropar)
- Formatação e conversão de tabelas de migração

### Proposta de Refatoração

```
src/migrator/
├── index.ts                    # Exports públicos
├── migrator.ts                 # Classe facade (orquestra os módulos)
├── types.ts                    # Tipos (manter)
├── table-format.ts             # Detecção de formato (manter)
├── executor/
│   ├── index.ts
│   ├── migration-executor.ts   # Execução de migrações
│   ├── batch-executor.ts       # Execução paralela em batch
│   └── types.ts
├── schema/
│   ├── index.ts
│   ├── schema-manager.ts       # Criar/dropar schemas
│   ├── schema-validator.ts     # Validação de existência
│   └── types.ts
├── sync/
│   ├── index.ts
│   ├── sync-manager.ts         # Sincronização de divergências
│   ├── orphan-cleaner.ts       # Limpeza de registros órfãos
│   └── types.ts
├── drift/
│   ├── index.ts
│   ├── drift-detector.ts       # Detecção de schema drift
│   ├── column-analyzer.ts      # Análise de colunas
│   ├── index-analyzer.ts       # Análise de índices
│   ├── constraint-analyzer.ts  # Análise de constraints
│   └── types.ts
└── seed/
    ├── index.ts
    ├── seeder.ts               # Execução de seeds
    └── types.ts
```

### Classes Propostas

#### 1.1 MigrationExecutor (~200 linhas)

```typescript
export class MigrationExecutor {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: MigratorConfig
  ) {}

  async executeMigration(tenantId: string, migration: MigrationFile): Promise<void>;
  async executeMigrations(tenantId: string, migrations: MigrationFile[]): Promise<TenantMigrationResult>;
  async markAsApplied(tenantId: string, migration: MigrationFile): Promise<void>;
}
```

#### 1.2 BatchExecutor (~150 linhas)

```typescript
export class BatchExecutor {
  constructor(
    private readonly executor: MigrationExecutor,
    private readonly options: BatchOptions
  ) {}

  async migrateAll(tenantIds: string[], migrations: MigrationFile[]): Promise<MigrationResult[]>;
  async migrateWithProgress(tenantIds: string[], options: ProgressOptions): Promise<void>;
}
```

#### 1.3 SchemaManager (~150 linhas)

```typescript
export class SchemaManager {
  constructor(private readonly pool: pg.Pool) {}

  async createSchema(tenantId: string, schemaName: string): Promise<void>;
  async dropSchema(tenantId: string, options?: DropOptions): Promise<void>;
  async schemaExists(schemaName: string): Promise<boolean>;
  async listSchemas(pattern?: string): Promise<string[]>;
}
```

#### 1.4 SyncManager (~200 linhas)

```typescript
export class SyncManager {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: MigratorConfig
  ) {}

  async getSyncStatus(tenantId: string): Promise<SyncStatus>;
  async syncMissing(tenantId: string, options?: SyncOptions): Promise<SyncResult>;
  async cleanOrphans(tenantId: string): Promise<CleanResult>;
}
```

#### 1.5 DriftDetector (~250 linhas)

```typescript
export class DriftDetector {
  constructor(private readonly pool: pg.Pool) {}

  async detectDrift(tenantId: string, schemaName: string): Promise<SchemaDrift>;
  async compareSchemas(source: string, target: string): Promise<SchemaDiff>;
  async getColumnDrift(schemaName: string, tableName: string): Promise<ColumnDrift[]>;
}
```

#### 1.6 Seeder (~100 linhas)

```typescript
export class Seeder {
  constructor(
    private readonly manager: TenantManager,
    private readonly config: SeederConfig
  ) {}

  async seed(tenantId: string, seedFn: SeedFunction): Promise<SeedResult>;
  async seedAll(tenantIds: string[], seedFn: SeedFunction): Promise<SeedResults>;
}
```

### Migrator como Facade

```typescript
export class Migrator {
  private readonly executor: MigrationExecutor;
  private readonly batchExecutor: BatchExecutor;
  private readonly schemaManager: SchemaManager;
  private readonly syncManager: SyncManager;
  private readonly driftDetector: DriftDetector;
  private readonly seeder: Seeder;

  // Delega para os módulos internos
  async migrateAll(options?: MigrateOptions) {
    return this.batchExecutor.migrateAll(...);
  }

  async createTenant(tenantId: string) {
    return this.schemaManager.createSchema(...);
  }

  async detectDrift(tenantId: string) {
    return this.driftDetector.detectDrift(...);
  }
}
```

### Benefícios

- Cada módulo < 250 linhas
- Testabilidade individual
- Reutilização de componentes
- Menor acoplamento
- Facilita contribuições

---

## 2. PoolManager (867 linhas) - ALTO

### Problema

A classe `PoolManager` acumula responsabilidades de:

- Cache LRU de pools
- Retry logic com exponential backoff
- Health checks
- Coleta de métricas
- Validação de conexões
- Lifecycle hooks

### Proposta de Refatoração

```
src/pool/
├── index.ts                    # Exports
├── pool-manager.ts             # Classe principal (facade)
├── types.ts                    # Tipos
├── cache/
│   ├── index.ts
│   ├── lru-cache.ts            # LRU eviction logic
│   └── ttl-manager.ts          # TTL cleanup
├── connection/
│   ├── index.ts
│   ├── pool-factory.ts         # Criação de pools
│   ├── connection-validator.ts # Validação de conexões
│   └── retry-handler.ts        # Retry com backoff
├── health/
│   ├── index.ts
│   ├── health-checker.ts       # Health checks
│   └── pool-metrics.ts         # Coleta de métricas
└── hooks/
    ├── index.ts
    └── lifecycle-hooks.ts      # Hook management
```

### Classes Propostas

#### 2.1 PoolCache (~150 linhas)

```typescript
export class PoolCache {
  private readonly cache: LRUCache<string, PoolEntry>;

  constructor(options: CacheOptions) {}

  get(tenantId: string): PoolEntry | undefined;
  set(tenantId: string, entry: PoolEntry): void;
  delete(tenantId: string): boolean;
  evictLRU(): string | undefined;
  clear(): void;
}
```

#### 2.2 ConnectionValidator (~100 linhas)

```typescript
export class ConnectionValidator {
  constructor(private readonly retryConfig: RetryConfig) {}

  async validate(pool: pg.Pool): Promise<boolean>;
  async validateWithRetry(pool: pg.Pool): Promise<boolean>;
}
```

#### 2.3 RetryHandler (~80 linhas)

```typescript
export class RetryHandler {
  constructor(private readonly config: RetryConfig) {}

  async withRetry<T>(operation: () => Promise<T>): Promise<T>;
  calculateDelay(attempt: number): number;
}
```

#### 2.4 HealthChecker (~120 linhas)

```typescript
export class HealthChecker {
  constructor(private readonly cache: PoolCache) {}

  async checkHealth(options?: HealthOptions): Promise<PoolHealth>;
  async ping(pool: pg.Pool): Promise<boolean>;
  async getMetrics(): Promise<MetricsResult>;
}
```

### PoolManager como Facade

```typescript
export class PoolManager {
  private readonly cache: PoolCache;
  private readonly validator: ConnectionValidator;
  private readonly healthChecker: HealthChecker;
  private readonly hooks: LifecycleHooks;

  async getDb(tenantId: string): Promise<TenantDb> {
    let entry = this.cache.get(tenantId);
    if (!entry) {
      entry = await this.createPool(tenantId);
      this.cache.set(tenantId, entry);
      await this.hooks.emit('poolCreated', tenantId);
    }
    return entry.db;
  }
}
```

---

## 3. CLI Menu (790 linhas) - ALTO

### Problema

O arquivo `menu.ts` contém 13+ funções procedurais que misturam:

- Renderização de UI
- Lógica de negócio
- Formatação de output
- Navegação entre menus

### Proposta de Refatoração

```
src/cli/ui/
├── index.ts                    # Exports
├── menu.ts                     # Menu principal (orquestra)
├── base/
│   ├── index.ts
│   ├── menu-renderer.ts        # Renderização base
│   └── table-formatter.ts      # Formatação de tabelas
├── screens/
│   ├── index.ts
│   ├── status-screen.ts        # Tela de status
│   ├── migrations-screen.ts    # Menu de migrações
│   ├── tenants-screen.ts       # Menu de tenants
│   ├── seeding-screen.ts       # Menu de seeding
│   └── generate-screen.ts      # Menu de geração
└── components/
    ├── index.ts
    ├── progress-bar.ts         # Barra de progresso
    ├── status-table.ts         # Tabela de status
    └── tenant-details.ts       # Detalhes de tenant
```

### Classes Propostas

#### 3.1 MenuRenderer (~100 linhas)

```typescript
export class MenuRenderer {
  constructor(private readonly config: RenderConfig) {}

  renderHeader(title: string): void;
  renderTable(data: TableData): void;
  renderProgress(current: number, total: number): void;
  renderSuccess(message: string): void;
  renderError(error: Error): void;
}
```

#### 3.2 StatusScreen (~100 linhas)

```typescript
export class StatusScreen {
  constructor(
    private readonly migrator: Migrator,
    private readonly renderer: MenuRenderer
  ) {}

  async show(): Promise<void>;
  async showTenantDetails(tenantId: string): Promise<void>;
}
```

#### 3.3 MigrationsScreen (~120 linhas)

```typescript
export class MigrationsScreen {
  constructor(
    private readonly migrator: Migrator,
    private readonly renderer: MenuRenderer
  ) {}

  async show(): Promise<MenuAction>;
  async runMigrations(): Promise<void>;
  async showProgress(results: AsyncIterable<MigrationProgress>): Promise<void>;
}
```

---

## Estratégia de Implementação

### Fase 1: Preparação (Low Risk)

1. Adicionar testes de caracterização para comportamento atual
2. Documentar APIs públicas existentes
3. Criar interfaces para os novos módulos

### Fase 2: Migrator (Maior Impacto)

1. Extrair `SchemaManager` primeiro (menor dependência)
2. Extrair `DriftDetector` (funcionalidade isolada)
3. Extrair `Seeder` (funcionalidade isolada)
4. Extrair `SyncManager` (depende de executor)
5. Extrair `MigrationExecutor` e `BatchExecutor`
6. Converter `Migrator` em facade

### Fase 3: PoolManager (Médio Impacto)

1. Extrair `PoolCache` (lógica de cache pura)
2. Extrair `RetryHandler` (utilitário)
3. Extrair `HealthChecker` (funcionalidade isolada)
4. Converter `PoolManager` em facade

### Fase 4: CLI Menu (Baixo Impacto)

1. Extrair `MenuRenderer` (formatação)
2. Extrair screens individuais
3. Manter menu principal como orquestrador

---

## Considerações de Breaking Changes

### APIs Públicas Preservadas

- `createMigrator()` - mantém assinatura
- `Migrator.migrateAll()` - mantém assinatura
- `Migrator.createTenant()` - mantém assinatura
- `PoolManager.getDb()` - mantém assinatura
- CLI commands - sem mudanças

### APIs Internas Modificadas

- Métodos privados do Migrator serão movidos para classes internas
- Hooks podem ganhar eventos mais granulares
- Debug output pode mudar formato

### Novas APIs Expostas (Opcional)

```typescript
// Acesso aos módulos internos para casos avançados
import { SchemaManager } from 'drizzle-multitenant/migrator/schema';
import { DriftDetector } from 'drizzle-multitenant/migrator/drift';
import { HealthChecker } from 'drizzle-multitenant/pool/health';
```

---

## Métricas de Sucesso

| Métrica | Antes | Depois |
|---------|-------|--------|
| Maior arquivo | 2,085 linhas | < 300 linhas |
| Média de linhas/arquivo | 638 | < 200 |
| Métodos por classe | 122+ | < 20 |
| Cobertura de testes | ~70% | > 90% |
| Complexidade ciclomática | Alta | Baixa |

---

## Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Regressões | Média | Testes de caracterização antes |
| Breaking changes | Baixa | Facade preserva API pública |
| Aumento de complexidade | Baixa | Documentação clara de módulos |
| Performance | Muito Baixa | Injeção de dependência é insignificante |

---

## Progresso

### Fase 1: Preparação - CONCLUÍDA

- [x] Testes de caracterização criados (74 testes)
- [x] APIs públicas documentadas (`docs/API_CONTRACTS.md`)
- [x] Interfaces definidas (`src/migrator/interfaces.ts`, `src/pool/interfaces.ts`)

### Fase 2: Migrator - CONCLUÍDA

- [x] `SchemaManager` extraído (19 testes, 280 linhas)
- [x] `DriftDetector` extraído (28 testes, ~450 linhas)
  - `drift-detector.ts` - Classe principal
  - `column-analyzer.ts` - Análise de colunas
  - `index-analyzer.ts` - Análise de índices
  - `constraint-analyzer.ts` - Análise de constraints
- [x] `Seeder` extraído (28 testes, ~340 linhas)
  - `seeder.ts` - Classe principal (301 linhas)
  - `types.ts` - Tipos internos (39 linhas)
  - `index.ts` - Exports públicos
- [x] `SyncManager` extraído (36 testes, ~450 linhas)
  - `sync-manager.ts` - Classe principal (~380 linhas)
  - `types.ts` - Tipos internos (~55 linhas)
  - `index.ts` - Exports públicos
- [x] `MigrationExecutor` e `BatchExecutor` extraídos (67 testes, ~650 linhas)
  - `migration-executor.ts` - Execução individual (~400 linhas)
  - `batch-executor.ts` - Execução paralela (~250 linhas)
  - `types.ts` - Tipos internos (~70 linhas)
  - `index.ts` - Exports públicos

### Fase 3: PoolManager - CONCLUÍDA

- [x] `PoolCache` extraído (28 testes, ~180 linhas)
  - `pool-cache.ts` - Classe principal com LRU eviction
  - `index.ts` - Exports públicos
- [x] `RetryHandler` extraído (25 testes, ~200 linhas)
  - `retry-handler.ts` - Classe com exponential backoff e jitter
  - `index.ts` - Exports públicos
- [x] `HealthChecker` extraído (31 testes, ~320 linhas)
  - `health-checker.ts` - Classe principal com ping e health check
  - `index.ts` - Exports públicos

### Fase 4: CLI Menu - CONCLUÍDA

- [x] `MenuRenderer` extraído (23 testes, ~200 linhas)
  - `menu-renderer.ts` - Classe base de renderização
  - `index.ts` - Exports públicos
- [x] Screens individuais extraídas (25 testes, ~550 linhas total)
  - `status-screen.ts` - Tela de status e detalhes (~130 linhas)
  - `migrations-screen.ts` - Tela de migrações (~110 linhas)
  - `tenants-screen.ts` - Tela de create/drop tenants (~170 linhas)
  - `seeding-screen.ts` - Tela de seeding (~160 linhas)
  - `generate-screen.ts` - Tela de geração (~50 linhas)
- [x] `MainMenu` refatorado como orquestrador (~270 linhas)

## Próximos Passos

1. [x] Revisar proposta com stakeholders
2. [x] Priorizar por impacto (Migrator primeiro)
3. [x] Implementar testes de caracterização
4. [x] Extrair `SchemaManager`
5. [x] Extrair `DriftDetector`
6. [x] Extrair `Seeder`
7. [x] Extrair `SyncManager`
8. [x] Extrair `MigrationExecutor` e `BatchExecutor`
9. [ ] Code review por módulo
10. [ ] Atualizar documentação
11. [x] Iniciar Fase 3: PoolManager
12. [x] Extrair `PoolCache`
13. [x] Extrair `RetryHandler`
14. [x] Extrair `HealthChecker`
15. [x] Iniciar Fase 4: CLI Menu
16. [x] Extrair `MenuRenderer`
17. [x] Extrair screens individuais

---

## Referências

- CLAUDE.md - Padrões do projeto
- [Single Responsibility Principle](https://en.wikipedia.org/wiki/Single-responsibility_principle)
- [Facade Pattern](https://refactoring.guru/design-patterns/facade)
- [Extract Class Refactoring](https://refactoring.guru/extract-class)
