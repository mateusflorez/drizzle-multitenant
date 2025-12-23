import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTenantContext } from './context.js';
import type { TenantManager } from './types.js';

describe('createTenantContext', () => {
  let mockManager: TenantManager<Record<string, unknown>, Record<string, unknown>>;
  let mockTenantDb: Record<string, unknown>;
  let mockSharedDb: Record<string, unknown>;

  beforeEach(() => {
    mockTenantDb = { tenant: true };
    mockSharedDb = { shared: true };

    mockManager = {
      getDb: vi.fn().mockReturnValue(mockTenantDb),
      getSharedDb: vi.fn().mockReturnValue(mockSharedDb),
      getSchemaName: vi.fn((id) => `tenant_${id}`),
      hasPool: vi.fn().mockReturnValue(false),
      getPoolCount: vi.fn().mockReturnValue(0),
      getActiveTenantIds: vi.fn().mockReturnValue([]),
      evictPool: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('runWithTenant', () => {
    it('should run callback with tenant context', async () => {
      const { runWithTenant, getTenantId } = createTenantContext(mockManager);

      let capturedTenantId: string | undefined;

      await runWithTenant({ tenantId: 'test-tenant' }, () => {
        capturedTenantId = getTenantId();
      });

      expect(capturedTenantId).toBe('test-tenant');
    });

    it('should support async callbacks', async () => {
      const { runWithTenant, getTenantId } = createTenantContext(mockManager);

      const result = await runWithTenant({ tenantId: 'async-tenant' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getTenantId();
      });

      expect(result).toBe('async-tenant');
    });

    it('should throw if tenantId is missing', () => {
      const { runWithTenant } = createTenantContext(mockManager);

      expect(() =>
        runWithTenant({ tenantId: '' }, () => {})
      ).toThrow('tenantId is required');
    });

    it('should support custom context data', async () => {
      interface CustomContext {
        userId: string;
        permissions: string[];
      }

      const { runWithTenant, getTenant } = createTenantContext<
        Record<string, unknown>,
        Record<string, unknown>,
        CustomContext
      >(mockManager);

      let capturedContext: { tenantId: string } & CustomContext | undefined;

      await runWithTenant(
        {
          tenantId: 'custom-tenant',
          userId: 'user-123',
          permissions: ['read', 'write'],
        },
        () => {
          capturedContext = getTenant();
        }
      );

      expect(capturedContext).toEqual({
        tenantId: 'custom-tenant',
        userId: 'user-123',
        permissions: ['read', 'write'],
      });
    });

    it('should isolate contexts in nested calls', async () => {
      const { runWithTenant, getTenantId } = createTenantContext(mockManager);

      const results: string[] = [];

      await runWithTenant({ tenantId: 'outer' }, async () => {
        results.push(getTenantId());

        await runWithTenant({ tenantId: 'inner' }, () => {
          results.push(getTenantId());
        });

        results.push(getTenantId());
      });

      expect(results).toEqual(['outer', 'inner', 'outer']);
    });
  });

  describe('getTenant', () => {
    it('should return full context', async () => {
      const { runWithTenant, getTenant } = createTenantContext(mockManager);

      await runWithTenant({ tenantId: 'test-tenant' }, () => {
        const context = getTenant();
        expect(context).toEqual({ tenantId: 'test-tenant' });
      });
    });

    it('should throw outside context', () => {
      const { getTenant } = createTenantContext(mockManager);

      expect(() => getTenant()).toThrow('No tenant context found');
    });
  });

  describe('getTenantOrNull', () => {
    it('should return context when available', async () => {
      const { runWithTenant, getTenantOrNull } = createTenantContext(mockManager);

      await runWithTenant({ tenantId: 'test-tenant' }, () => {
        const context = getTenantOrNull();
        expect(context).toEqual({ tenantId: 'test-tenant' });
      });
    });

    it('should return undefined outside context', () => {
      const { getTenantOrNull } = createTenantContext(mockManager);

      expect(getTenantOrNull()).toBeUndefined();
    });
  });

  describe('getTenantId', () => {
    it('should return tenant ID', async () => {
      const { runWithTenant, getTenantId } = createTenantContext(mockManager);

      await runWithTenant({ tenantId: 'test-tenant' }, () => {
        expect(getTenantId()).toBe('test-tenant');
      });
    });

    it('should throw outside context', () => {
      const { getTenantId } = createTenantContext(mockManager);

      expect(() => getTenantId()).toThrow('No tenant context found');
    });
  });

  describe('getTenantDb', () => {
    it('should return tenant database', async () => {
      const { runWithTenant, getTenantDb } = createTenantContext(mockManager);

      await runWithTenant({ tenantId: 'test-tenant' }, () => {
        const db = getTenantDb();
        expect(db).toBe(mockTenantDb);
        expect(mockManager.getDb).toHaveBeenCalledWith('test-tenant');
      });
    });

    it('should throw outside context', () => {
      const { getTenantDb } = createTenantContext(mockManager);

      expect(() => getTenantDb()).toThrow('No tenant context found');
    });
  });

  describe('getSharedDb', () => {
    it('should return shared database', () => {
      const { getSharedDb } = createTenantContext(mockManager);

      const db = getSharedDb();
      expect(db).toBe(mockSharedDb);
      expect(mockManager.getSharedDb).toHaveBeenCalled();
    });

    it('should work outside tenant context', () => {
      const { getSharedDb } = createTenantContext(mockManager);

      // Should not throw
      expect(() => getSharedDb()).not.toThrow();
    });
  });

  describe('isInTenantContext', () => {
    it('should return true inside context', async () => {
      const { runWithTenant, isInTenantContext } = createTenantContext(mockManager);

      await runWithTenant({ tenantId: 'test-tenant' }, () => {
        expect(isInTenantContext()).toBe(true);
      });
    });

    it('should return false outside context', () => {
      const { isInTenantContext } = createTenantContext(mockManager);

      expect(isInTenantContext()).toBe(false);
    });
  });

  describe('concurrent contexts', () => {
    it('should maintain separate contexts for concurrent operations', async () => {
      const { runWithTenant, getTenantId } = createTenantContext(mockManager);

      const results = await Promise.all([
        runWithTenant({ tenantId: 'tenant-1' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return getTenantId();
        }),
        runWithTenant({ tenantId: 'tenant-2' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return getTenantId();
        }),
        runWithTenant({ tenantId: 'tenant-3' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return getTenantId();
        }),
      ]);

      expect(results).toEqual(['tenant-1', 'tenant-2', 'tenant-3']);
    });
  });
});
