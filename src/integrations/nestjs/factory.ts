import { Injectable, Inject } from '@nestjs/common';
import { TENANT_MANAGER } from './constants.js';
import type { TenantManager, TenantDb, SharedDb } from '../../types.js';

/**
 * Debug information for tenant database connections
 */
export interface TenantDbDebugInfo {
  tenantId: string;
  schemaName: string;
  isProxy: boolean;
  poolCount: number;
}

/**
 * Factory for creating tenant database connections
 *
 * Use this when you need to access tenant databases in singleton services
 * (cron jobs, event handlers, background workers, etc.)
 *
 * @example
 * ```typescript
 * // Service stays singleton - no scope change needed
 * @Injectable()
 * export class ReportService {
 *   constructor(private dbFactory: TenantDbFactory) {}
 *
 *   async generateReport(tenantId: string) {
 *     const db = this.dbFactory.getDb(tenantId);
 *     return db.select().from(reports);
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Cron job usage
 * @Injectable()
 * export class DailyReportCron {
 *   constructor(private dbFactory: TenantDbFactory) {}
 *
 *   @Cron('0 8 * * *')
 *   async generateDailyReports() {
 *     const tenants = await this.getTenantIds();
 *     for (const tenantId of tenants) {
 *       const db = this.dbFactory.getDb(tenantId);
 *       await this.processReports(db);
 *     }
 *   }
 * }
 * ```
 */
@Injectable()
export class TenantDbFactory<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  constructor(
    @Inject(TENANT_MANAGER) private readonly manager: TenantManager<TTenantSchema, TSharedSchema>,
  ) {}

  /**
   * Get a tenant database connection by tenant ID
   *
   * @param tenantId - The tenant identifier
   * @returns The tenant-scoped Drizzle database instance
   *
   * @throws Error if tenantId is empty or invalid
   */
  getDb(tenantId: string): TenantDb<TTenantSchema> {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error(
        '[drizzle-multitenant] TenantDbFactory.getDb() requires a valid tenantId string.'
      );
    }
    return this.manager.getDb(tenantId);
  }

  /**
   * Get the shared database connection
   *
   * @returns The shared Drizzle database instance
   */
  getSharedDb(): SharedDb<TSharedSchema> {
    return this.manager.getSharedDb();
  }

  /**
   * Get the schema name for a tenant
   *
   * @param tenantId - The tenant identifier
   * @returns The schema name for the tenant
   */
  getSchemaName(tenantId: string): string {
    return this.manager.getSchemaName(tenantId);
  }

  /**
   * Get debug information for a tenant database
   *
   * @param tenantId - The tenant identifier
   * @returns Debug information including schema name and pool stats
   */
  getDebugInfo(tenantId: string): TenantDbDebugInfo {
    return {
      tenantId,
      schemaName: this.manager.getSchemaName(tenantId),
      isProxy: false, // Factory returns direct db, not proxy
      poolCount: this.manager.getPoolCount(),
    };
  }

  /**
   * Get the underlying TenantManager instance
   *
   * Use this for advanced operations like pool management
   *
   * @returns The TenantManager instance
   */
  getManager(): TenantManager<TTenantSchema, TSharedSchema> {
    return this.manager;
  }
}
