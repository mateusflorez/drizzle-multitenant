import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTenantManager } from './manager.js';
import type { Config } from './types.js';

// Mock pg
vi.mock('pg', () => {
  const mockPool = {
    on: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return {
    Pool: vi.fn(() => mockPool),
  };
});

// Mock drizzle-orm
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({ mockDb: true })),
}));

describe('createTenantManager', () => {
  let config: Config<Record<string, unknown>, Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      connection: {
        url: 'postgresql://localhost:5432/test',
      },
      isolation: {
        strategy: 'schema',
        schemaNameTemplate: (id) => `tenant_${id}`,
      },
      schemas: {
        tenant: { users: {} },
        shared: { plans: {} },
      },
    };
  });

  it('should create a tenant manager', () => {
    const manager = createTenantManager(config);
    expect(manager).toBeDefined();
    expect(manager.getDb).toBeInstanceOf(Function);
    expect(manager.getSharedDb).toBeInstanceOf(Function);
    expect(manager.getSchemaName).toBeInstanceOf(Function);
    expect(manager.hasPool).toBeInstanceOf(Function);
    expect(manager.getPoolCount).toBeInstanceOf(Function);
    expect(manager.getActiveTenantIds).toBeInstanceOf(Function);
    expect(manager.evictPool).toBeInstanceOf(Function);
    expect(manager.dispose).toBeInstanceOf(Function);
  });

  it('should provide working getDb', async () => {
    const manager = createTenantManager(config);
    const db = manager.getDb('tenant-1');
    expect(db).toBeDefined();
    await manager.dispose();
  });

  it('should provide working getSharedDb', async () => {
    const manager = createTenantManager(config);
    const db = manager.getSharedDb();
    expect(db).toBeDefined();
    await manager.dispose();
  });

  it('should provide working getSchemaName', async () => {
    const manager = createTenantManager(config);
    expect(manager.getSchemaName('test')).toBe('tenant_test');
    await manager.dispose();
  });

  it('should provide working hasPool', async () => {
    const manager = createTenantManager(config);
    expect(manager.hasPool('tenant-1')).toBe(false);
    manager.getDb('tenant-1');
    expect(manager.hasPool('tenant-1')).toBe(true);
    await manager.dispose();
  });

  it('should provide working getPoolCount', async () => {
    const manager = createTenantManager(config);
    expect(manager.getPoolCount()).toBe(0);
    manager.getDb('tenant-1');
    expect(manager.getPoolCount()).toBe(1);
    await manager.dispose();
  });

  it('should provide working getActiveTenantIds', async () => {
    const manager = createTenantManager(config);
    manager.getDb('tenant-1');
    manager.getDb('tenant-2');
    const ids = manager.getActiveTenantIds();
    expect(ids).toContain('tenant-1');
    expect(ids).toContain('tenant-2');
    await manager.dispose();
  });

  it('should provide working evictPool', async () => {
    const manager = createTenantManager(config);
    manager.getDb('tenant-1');
    expect(manager.hasPool('tenant-1')).toBe(true);
    await manager.evictPool('tenant-1');
    expect(manager.hasPool('tenant-1')).toBe(false);
    await manager.dispose();
  });

  it('should provide working dispose', async () => {
    const manager = createTenantManager(config);
    manager.getDb('tenant-1');
    manager.getDb('tenant-2');
    await manager.dispose();
    expect(manager.getPoolCount()).toBe(0);
  });
});
