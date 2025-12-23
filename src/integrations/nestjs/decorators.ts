import { Inject, SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  TENANT_DB,
  SHARED_DB,
  TENANT_CONTEXT,
  TENANT_MANAGER,
  REQUIRES_TENANT_KEY,
  IS_PUBLIC_KEY,
} from './constants.js';
import type { TenantRequest, NestTenantContext } from './types.js';

/**
 * Inject the tenant database for the current request
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class UserService {
 *   constructor(@InjectTenantDb() private readonly db: TenantDb) {}
 *
 *   async findAll() {
 *     return this.db.select().from(users);
 *   }
 * }
 * ```
 */
export const InjectTenantDb = (): ParameterDecorator => Inject(TENANT_DB);

/**
 * Inject the shared database
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class PlanService {
 *   constructor(@InjectSharedDb() private readonly db: SharedDb) {}
 *
 *   async findAll() {
 *     return this.db.select().from(plans);
 *   }
 * }
 * ```
 */
export const InjectSharedDb = (): ParameterDecorator => Inject(SHARED_DB);

/**
 * Inject the tenant context
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class AuditService {
 *   constructor(@InjectTenantContext() private readonly ctx: NestTenantContext) {}
 *
 *   log(action: string) {
 *     console.log(`[${this.ctx.tenantId}] ${action}`);
 *   }
 * }
 * ```
 */
export const InjectTenantContext = (): ParameterDecorator => Inject(TENANT_CONTEXT);

/**
 * Inject the tenant manager
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class TenantService {
 *   constructor(@InjectTenantManager() private readonly manager: TenantManager) {}
 *
 *   getPoolCount() {
 *     return this.manager.getPoolCount();
 *   }
 * }
 * ```
 */
export const InjectTenantManager = (): ParameterDecorator => Inject(TENANT_MANAGER);

/**
 * Get the current tenant context from the request
 * Use this in controllers to access tenant information
 *
 * @example
 * ```typescript
 * @Controller('users')
 * export class UserController {
 *   @Get()
 *   findAll(@TenantCtx() ctx: NestTenantContext) {
 *     console.log(`Fetching users for tenant: ${ctx.tenantId}`);
 *     return this.userService.findAll();
 *   }
 * }
 * ```
 */
export const TenantCtx = createParamDecorator(
  (data: keyof NestTenantContext | undefined, ctx: ExecutionContext): NestTenantContext | unknown => {
    const request = ctx.switchToHttp().getRequest<TenantRequest>();
    const tenantContext = request.tenantContext;

    if (!tenantContext) {
      throw new Error('Tenant context not found. Make sure TenantGuard is applied.');
    }

    return data ? tenantContext[data] : tenantContext;
  }
);

/**
 * Get the current tenant ID from the request
 * Shorthand for @TenantCtx('tenantId')
 *
 * @example
 * ```typescript
 * @Controller('users')
 * export class UserController {
 *   @Get()
 *   findAll(@TenantId() tenantId: string) {
 *     console.log(`Fetching users for tenant: ${tenantId}`);
 *     return this.userService.findAll();
 *   }
 * }
 * ```
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<TenantRequest>();
    const tenantId = request.tenantContext?.tenantId ?? request.tenantId;

    if (!tenantId) {
      throw new Error('Tenant ID not found. Make sure TenantGuard is applied.');
    }

    return tenantId;
  }
);

/**
 * Mark a route as requiring a tenant context
 * Used with TenantGuard to enforce tenant requirement
 *
 * @example
 * ```typescript
 * @Controller('users')
 * @RequiresTenant()
 * export class UserController {
 *   // All routes in this controller require a tenant
 * }
 * ```
 */
export const RequiresTenant = (): ClassDecorator & MethodDecorator =>
  SetMetadata(REQUIRES_TENANT_KEY, true);

/**
 * Mark a route as public (no tenant required)
 * Use this to exclude specific routes from tenant requirement
 *
 * @example
 * ```typescript
 * @Controller('health')
 * export class HealthController {
 *   @Get()
 *   @PublicRoute()
 *   check() {
 *     return { status: 'ok' };
 *   }
 * }
 * ```
 */
export const PublicRoute = (): MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);
