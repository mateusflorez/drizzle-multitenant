import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  TENANT_MODULE_OPTIONS,
  TENANT_MANAGER,
  REQUIRES_TENANT_KEY,
  IS_PUBLIC_KEY,
} from './constants.js';
import type { TenantModuleOptions, TenantRequest, NestTenantContext, TenantManager } from './types.js';

/**
 * Guard that extracts and validates tenant ID from requests
 *
 * This guard should be applied globally or to specific controllers/routes
 * that require tenant context.
 *
 * @example
 * ```typescript
 * // Apply globally in main.ts
 * const app = await NestFactory.create(AppModule);
 * app.useGlobalGuards(app.get(TenantGuard));
 *
 * // Or apply to specific controllers
 * @Controller('users')
 * @UseGuards(TenantGuard)
 * export class UserController {}
 * ```
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(TENANT_MODULE_OPTIONS)
    private readonly options: TenantModuleOptions,
    @Inject(TENANT_MANAGER)
    private readonly tenantManager: TenantManager,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Check if tenant is required
    const requiresTenant = this.reflector.getAllAndOverride<boolean>(REQUIRES_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<TenantRequest>();

    // Extract tenant ID
    const tenantId = await this.options.extractTenantId(request);

    if (!tenantId) {
      // If tenant is explicitly required, throw error
      if (requiresTenant) {
        throw new BadRequestException('Tenant ID is required');
      }
      // Otherwise, allow the request without tenant context
      return true;
    }

    // Validate tenant if validator is provided
    if (this.options.validateTenant) {
      const isValid = await this.options.validateTenant(tenantId);
      if (!isValid) {
        throw new UnauthorizedException(`Invalid tenant: ${tenantId}`);
      }
    }

    // Get schema name
    const schemaName = this.tenantManager.getSchemaName(tenantId);

    // Build tenant context
    let tenantContext: NestTenantContext = {
      tenantId,
      schemaName,
    };

    // Enrich context if enricher is provided
    if (this.options.enrichContext) {
      const extraContext = await this.options.enrichContext(tenantId, request);
      tenantContext = { ...tenantContext, ...extraContext };
    }

    // Attach to request
    request.tenantContext = tenantContext;
    request.tenantId = tenantId;

    return true;
  }
}

/**
 * Guard that requires a valid tenant context
 * Throws error if tenant is not present
 *
 * Use this when you want to ensure a route always has a tenant,
 * regardless of the @RequiresTenant decorator.
 *
 * @example
 * ```typescript
 * @Controller('users')
 * @UseGuards(RequireTenantGuard)
 * export class UserController {
 *   // All routes require tenant
 * }
 * ```
 */
@Injectable()
export class RequireTenantGuard implements CanActivate {
  constructor(
    @Inject(TENANT_MODULE_OPTIONS)
    private readonly options: TenantModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();

    // Check if tenant context already exists (set by TenantGuard)
    if (request.tenantContext?.tenantId) {
      return true;
    }

    // Try to extract tenant ID
    const tenantId = await this.options.extractTenantId(request);

    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required for this route');
    }

    return true;
  }
}
