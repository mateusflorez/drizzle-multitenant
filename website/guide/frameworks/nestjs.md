# NestJS

Full integration with NestJS using modules, decorators, and guards.

## Module Setup

```typescript
import { Module } from '@nestjs/common';
import { TenantModule } from 'drizzle-multitenant/nestjs';
import { tenantConfig } from './tenant.config';

@Module({
  imports: [
    TenantModule.forRoot({
      config: tenantConfig,
      extractTenantId: (req) => req.headers['x-tenant-id'] as string,
      global: true,
    }),
  ],
})
export class AppModule {}
```

## Request-Scoped Services

```typescript
import { Injectable, Scope } from '@nestjs/common';
import { InjectTenantDb } from 'drizzle-multitenant/nestjs';

@Injectable({ scope: Scope.REQUEST })
export class UserService {
  constructor(
    @InjectTenantDb()
    private readonly db: TenantDb
  ) {}

  async findAll() {
    return this.db.select().from(users);
  }
}
```

## Singleton Services (Cron Jobs, Event Handlers)

Use `TenantDbFactory` for singleton services:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectTenantDbFactory, TenantDbFactory } from 'drizzle-multitenant/nestjs';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class ReportService {
  constructor(
    @InjectTenantDbFactory()
    private dbFactory: TenantDbFactory
  ) {}

  async generateReport(tenantId: string) {
    const db = this.dbFactory.getDb(tenantId);
    return db.select().from(reports);
  }
}

@Injectable()
export class DailyReportCron {
  constructor(
    @InjectTenantDbFactory()
    private dbFactory: TenantDbFactory
  ) {}

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

## Available Decorators

| Decorator | Description |
|-----------|-------------|
| `@InjectTenantDb()` | Inject tenant database (request-scoped) |
| `@InjectTenantDbFactory()` | Inject factory for singleton services |
| `@InjectSharedDb()` | Inject shared database |
| `@InjectTenantContext()` | Inject tenant context |
| `@InjectTenantManager()` | Inject tenant manager |
| `@RequiresTenant()` | Mark route as requiring tenant |
| `@PublicRoute()` | Mark route as public |

## Guards

```typescript
import { Controller, Get } from '@nestjs/common';
import { RequiresTenant, PublicRoute } from 'drizzle-multitenant/nestjs';

@Controller('users')
@RequiresTenant() // All routes require tenant
export class UsersController {
  @Get()
  findAll() {
    // Requires X-Tenant-ID header
  }
}

@Controller()
export class HealthController {
  @Get('health')
  @PublicRoute() // No tenant required
  health() {
    return { status: 'ok' };
  }
}
```

## Debugging

```typescript
console.log(tenantDb);
// [TenantDb] tenant=123 schema=tenant_123

console.log(tenantDb.__debug);
// { tenantId: '123', schemaName: 'tenant_123', isProxy: true, poolCount: 5 }

console.log(tenantDb.__tenantId); // '123'
```

## Full Example

See the [NestJS example](/examples/nestjs) for a complete working project with modules, controllers, and services.
