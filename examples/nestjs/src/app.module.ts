import { Module } from "@nestjs/common";
import { TenantModule } from "drizzle-multitenant/nestjs";
import { tenantConfig } from "./tenant.config";
import { UsersModule } from "./users/users.module";
import { OrdersModule } from "./orders/orders.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    // Register TenantModule globally
    TenantModule.forRoot({
      config: tenantConfig,
      extractTenantId: (request) => request.headers["x-tenant-id"] as string,
      global: true,
    }),
    UsersModule,
    OrdersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
