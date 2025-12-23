import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { createTenantContext as createContext } from '../../context.js';
import { TENANT_MANAGER } from './constants.js';
import type { TenantManager, TenantRequest } from './types.js';

/**
 * Interceptor that sets up AsyncLocalStorage context for tenant
 *
 * This interceptor ensures that tenant context is available via
 * AsyncLocalStorage throughout the request lifecycle, enabling
 * access to tenant info in services that don't have request scope.
 *
 * @example
 * ```typescript
 * // Apply globally
 * const app = await NestFactory.create(AppModule);
 * app.useGlobalInterceptors(app.get(TenantContextInterceptor));
 *
 * // Or apply to specific controllers
 * @Controller('users')
 * @UseInterceptors(TenantContextInterceptor)
 * export class UserController {}
 * ```
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly tenantContext: ReturnType<typeof createContext<{ tenantId: string }>>;

  constructor(
    @Inject(TENANT_MANAGER)
    private readonly tenantManager: TenantManager,
  ) {
    this.tenantContext = createContext<{ tenantId: string }>(
      this.tenantManager as unknown as TenantManager<{ tenantId: string }, Record<string, unknown>>
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const tenantId = request.tenantContext?.tenantId ?? request.tenantId;

    // If no tenant, just proceed normally
    if (!tenantId) {
      return next.handle();
    }

    // Run the handler within tenant context
    return from(
      this.tenantContext.runWithTenant({ tenantId }, () => {
        return next.handle().toPromise();
      })
    ).pipe(
      switchMap((result) => {
        if (result instanceof Observable) {
          return result;
        }
        return from([result]);
      })
    );
  }
}

/**
 * Interceptor that logs tenant information for each request
 *
 * Useful for debugging and audit purposes.
 *
 * @example
 * ```typescript
 * @Controller('users')
 * @UseInterceptors(TenantLoggingInterceptor)
 * export class UserController {}
 * ```
 */
@Injectable()
export class TenantLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const tenantId = request.tenantContext?.tenantId ?? request.tenantId;
    const method = request.method;
    const url = request.url;

    const start = Date.now();

    console.log(`[Tenant: ${tenantId ?? 'none'}] ${method} ${url} - Started`);

    return next.handle().pipe(
      switchMap((result) => {
        const duration = Date.now() - start;
        console.log(`[Tenant: ${tenantId ?? 'none'}] ${method} ${url} - ${duration}ms`);
        return from([result]);
      })
    );
  }
}
