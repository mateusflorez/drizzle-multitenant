# Proposal: Melhorias Identificadas

> **Status**: Proposta
> **Data**: 2024-12-23

## Contexto

Durante a integração do `drizzle-multitenant` no projeto, foram identificadas melhorias que beneficiariam o pacote e outros usuários.

---

## 1. CLI: Flag `--mark-applied`

### Problema

Projetos que já têm migrations aplicadas (via scripts legados) precisam sincronizar o tracking sem re-executar as migrations.

### Solução

Adicionar flag `--mark-applied` ao comando `migrate`:

```bash
# Marca migrations como aplicadas sem executar SQL
npx drizzle-multitenant migrate --all --mark-applied

# Para tenant específico
npx drizzle-multitenant migrate --tenant=abc --mark-applied
```

### Implementação

```typescript
// src/cli/commands/migrate.ts
.option('--mark-applied', 'Mark migrations as applied without executing SQL')

// No handler
if (options.markApplied) {
  await migrator.markAllAsApplied(tenantIds);
} else {
  await migrator.migrateAll({ concurrency, dryRun });
}
```

### Benefício

- Facilita migração de projetos existentes
- Útil para sincronizar ambientes de staging/produção
- Evita necessidade de scripts manuais

---

## 2. CLI: Comando `sync`

### Problema

Detectar e corrigir divergências entre migrations em disco e tracking no banco.

### Solução

Novo comando `sync` com opções:

```bash
# Mostrar divergências
npx drizzle-multitenant sync --status

# Marcar migrations faltantes como aplicadas
npx drizzle-multitenant sync --mark-missing

# Remover registros órfãos (migrations que não existem mais em disco)
npx drizzle-multitenant sync --clean-orphans
```

### Casos de Uso

1. **Migration renomeada**: Arquivo renomeado, mas registro antigo no banco
2. **Migration deletada**: Arquivo removido, registro ainda existe
3. **Ambiente dessincronizado**: Migrations aplicadas manualmente

---

## 3. Compatibilidade com Tabelas de Tracking Legadas

### Problema

Projetos podem usar estruturas de tabela diferentes:
- Hash-based: `id, hash, created_at`
- Name-based: `id, name, applied_at` (padrão drizzle-multitenant)

### Solução

Suportar múltiplos formatos ou migração automática:

```typescript
// tenant.config.ts
migrations: {
  tenantFolder: "./drizzle/tenant",
  tenantDiscovery: discoverTenants,
  migrationsTable: "__drizzle_migrations",

  // NOVO: Formato da tabela
  tableFormat: "name", // "name" | "hash" | "auto-detect"

  // NOVO: Migrar formato automaticamente
  autoMigrateFormat: true,
}
```

### Alternativa

Script de migração incluído no pacote:

```bash
npx drizzle-multitenant migrate-tracking-format --from=hash --to=name
```

---

## 4. Health Check API

### Problema

Aplicações precisam verificar saúde dos pools para load balancers e monitoring.

### Solução

Método `healthCheck()` no TenantManager:

```typescript
const manager = createTenantManager(config);

const health = await manager.healthCheck();
// {
//   healthy: true,
//   pools: [
//     { tenantId: 'abc', status: 'ok', connections: 5, idle: 3 },
//     { tenantId: 'def', status: 'degraded', connections: 1, idle: 0 },
//   ],
//   sharedDb: { status: 'ok', connections: 10 },
//   timestamp: '2024-12-23T10:30:00Z'
// }

// Endpoint para load balancers
app.get('/health/db', async (req, res) => {
  const health = await manager.healthCheck();
  res.status(health.healthy ? 200 : 503).json(health);
});
```

### Já no Roadmap

Previsto para v1.1.0 (Resiliência e Observabilidade).

---

## 5. Métricas Prometheus

### Problema

Monitoramento de pools e queries é essencial para produção.

### Solução

Exportar métricas no formato Prometheus:

```typescript
// Configuração
const config = defineConfig({
  metrics: {
    enabled: true,
    prefix: 'drizzle_multitenant',
  },
});

// Endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(manager.getPrometheusMetrics());
});
```

**Métricas sugeridas:**
```
drizzle_multitenant_pool_count 15
drizzle_multitenant_pool_connections_active{tenant="abc"} 3
drizzle_multitenant_pool_connections_idle{tenant="abc"} 7
drizzle_multitenant_pool_evictions_total 42
drizzle_multitenant_query_duration_seconds_bucket{le="0.1"} 1024
```

### Já no Roadmap

Previsto para v1.1.0 (Resiliência e Observabilidade).

---

## 6. NestJS: `@TenantId()` Parameter Decorator

### Problema

Extrair `tenantId` do request requer código boilerplate:

```typescript
@Get()
async getData(@Param('empresaId') empresaId: string) {
  return this.service.getData(empresaId);
}
```

### Solução

Decorator que extrai automaticamente baseado na config:

```typescript
import { TenantId } from 'drizzle-multitenant/nestjs';

@Get()
async getData(@TenantId() tenantId: string) {
  return this.service.getData(tenantId);
}
```

### Implementação

```typescript
// src/integrations/nestjs/decorators/tenant-id.decorator.ts
export const TenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    // Usa extractTenantId configurado no TenantModule
    return request.tenantId; // Setado pelo middleware
  },
);
```

---

## 7. Pool Warmup

### Problema

Primeiro request para um tenant tem latência maior (cold start do pool).

### Solução

API para pré-aquecer pools:

```typescript
// Warmup de tenants específicos
await manager.warmup(['tenant-1', 'tenant-2', 'tenant-3']);

// Warmup de todos (usar com cuidado)
const tenants = await discoverTenants();
await manager.warmup(tenants.slice(0, 20)); // Top 20 mais ativos

// No bootstrap da aplicação NestJS
@Injectable()
export class WarmupService implements OnApplicationBootstrap {
  constructor(@InjectTenantManager() private manager: TenantManager) {}

  async onApplicationBootstrap() {
    const topTenants = await this.getTopTenants();
    await this.manager.warmup(topTenants);
  }
}
```

---

## 8. Debug Mode Aprimorado

### Problema

Debugar queries multi-tenant é difícil sem contexto.

### Solução

Modo debug que loga queries com tenant context:

```typescript
const config = defineConfig({
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    logQueries: true,
    logPoolEvents: true,
    slowQueryThreshold: 1000, // ms
  },
});

// Output
// [drizzle-multitenant] tenant=abc query="SELECT * FROM produtos" duration=45ms
// [drizzle-multitenant] tenant=abc SLOW_QUERY query="SELECT..." duration=1523ms
```

---

## 9. Retry Logic para Conexões

### Problema

Conexões podem falhar temporariamente (network issues, DB restart).

### Solução

Retry automático com backoff exponencial:

```typescript
const config = defineConfig({
  connection: {
    url: process.env.DATABASE_URL!,
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    },
  },
});
```

### Já no Roadmap

Previsto para v1.1.0 (Resiliência e Observabilidade).

---

## 10. Cross-Schema Query Improvements

### Problema

Queries que juntam tenant + shared tables são verbosas.

### Solução Atual (v1.0)

```typescript
const query = createCrossSchemaQuery({
  tenantDb: tenants.getDb('tenant-123'),
  sharedDb: tenants.getSharedDb(),
  tenantSchema: 'tenant_123',
  sharedSchema: 'public',
});
```

### Solução Proposta

Helper mais simples:

```typescript
// Usando TenantDbFactory
const db = this.dbFactory.getDb(tenantId);

// Novo: withShared() helper
const result = await db
  .withShared(this.sharedDb)
  .select({
    pedidoId: pedido.id,
    workflowNome: workflowStep.nome, // da tabela public
  })
  .from(pedido)
  .leftJoin(workflowStep, eq(pedido.workflowStepId, workflowStep.id));
```

---

## Priorização Sugerida

| Melhoria | Esforço | Impacto | Prioridade |
|----------|---------|---------|------------|
| `--mark-applied` flag | 2h | Alto | P0 |
| `@TenantId()` decorator | 1h | Médio | P1 |
| Pool warmup | 2h | Médio | P1 |
| Health check API | 4h | Alto | P1 |
| Debug mode | 3h | Médio | P2 |
| Retry logic | 4h | Alto | P2 |
| Métricas Prometheus | 6h | Alto | P2 |
| Sync command | 4h | Médio | P2 |
| Tabela legada compat | 4h | Baixo | P3 |
| Cross-schema helper | 6h | Médio | P3 |

---

## Referências

- [drizzle-multitenant Roadmap](../roadmap.md)
