# Framework Integrations

## Express

```typescript
import { createExpressMiddleware } from 'drizzle-multitenant/express';

const middleware = createExpressMiddleware({
  manager: tenants,
  extractTenantId: (req) => req.headers['x-tenant-id'] as string,
  validateTenant: async (id) => checkTenantExists(id),
});

app.use('/api/:tenantId/*', middleware);
```

## Fastify

```typescript
import { fastifyTenantPlugin } from 'drizzle-multitenant/fastify';

await fastify.register(fastifyTenantPlugin, {
  manager: tenants,
  extractTenantId: (req) => req.headers['x-tenant-id'] as string,
});
```

## NestJS

### Module Setup

```typescript
import { TenantModule, InjectTenantDb } from 'drizzle-multitenant/nestjs';

@Module({
  imports: [
    TenantModule.forRoot({
      config: tenantConfig,
      extractTenantId: (req) => req.headers['x-tenant-id'],
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

### Request-Scoped Services

```typescript
@Injectable({ scope: Scope.REQUEST })
export class UserService {
  constructor(@InjectTenantDb() private readonly db: TenantDb) {}

  async findAll() {
    return this.db.select().from(users);
  }
}
```

### Singleton Services (Cron Jobs, Event Handlers)

Use `TenantDbFactory` for singleton services:

```typescript
import { TenantDbFactory, InjectTenantDbFactory } from 'drizzle-multitenant/nestjs';

@Injectable()
export class ReportService {
  constructor(@InjectTenantDbFactory() private dbFactory: TenantDbFactory) {}

  async generateReport(tenantId: string) {
    const db = this.dbFactory.getDb(tenantId);
    return db.select().from(reports);
  }
}

@Injectable()
export class DailyReportCron {
  constructor(@InjectTenantDbFactory() private dbFactory: TenantDbFactory) {}

  @Cron('0 8 * * *')
  async run() {
    const tenants = await this.getTenantIds();
    for (const tenantId of tenants) {
      const db = this.dbFactory.getDb(tenantId);
      await this.processReports(db);
    }
  }
}
```

### Available Decorators

| Decorator | Description |
|-----------|-------------|
| `@InjectTenantDb()` | Inject tenant database (request-scoped) |
| `@InjectTenantDbFactory()` | Inject factory for singleton services |
| `@InjectSharedDb()` | Inject shared database |
| `@InjectTenantContext()` | Inject tenant context |
| `@InjectTenantManager()` | Inject tenant manager |
| `@RequiresTenant()` | Mark route as requiring tenant |
| `@PublicRoute()` | Mark route as public |

### Debugging

```typescript
console.log(tenantDb);
// [TenantDb] tenant=123 schema=empresa_123

console.log(tenantDb.__debug);
// { tenantId: '123', schemaName: 'empresa_123', isProxy: true, poolCount: 5 }

console.log(tenantDb.__tenantId); // '123'
```
