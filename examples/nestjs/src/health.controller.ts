import { Controller, Get } from "@nestjs/common";
import { InjectTenantManager, PublicRoute } from "drizzle-multitenant/nestjs";
import type { TenantManager } from "drizzle-multitenant";

@Controller()
export class HealthController {
  constructor(
    @InjectTenantManager()
    private readonly tenantManager: TenantManager<any, any>
  ) {}

  @Get("health")
  @PublicRoute()
  health() {
    return {
      status: "ok",
      pools: this.tenantManager.getPoolCount(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get("admin/pools")
  @PublicRoute()
  pools() {
    return {
      count: this.tenantManager.getPoolCount(),
    };
  }
}
