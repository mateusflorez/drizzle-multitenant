import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatusScreen } from './status-screen.js';
import { MigrationsScreen } from './migrations-screen.js';
import { TenantsScreen } from './tenants-screen.js';
import { SeedingScreen } from './seeding-screen.js';
import { GenerateScreen } from './generate-screen.js';
import { MenuRenderer } from '../base/menu-renderer.js';
import type { MenuContext, TenantMigrationStatus } from '../types.js';

// Mock inquirer
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
  checkbox: vi.fn(),
}));

// Mock migrator
vi.mock('../../../migrator/migrator.js', () => ({
  createMigrator: vi.fn(() => ({
    getStatus: vi.fn(() => []),
    migrateAll: vi.fn(() => ({ succeeded: 0, failed: 0, details: [] })),
    seedAll: vi.fn(() => ({ succeeded: 0, failed: 0, details: [] })),
    tenantExists: vi.fn(() => false),
    createTenant: vi.fn(),
    dropTenant: vi.fn(),
  })),
}));

describe('Screens', () => {
  let mockRenderer: MenuRenderer;
  let mockContext: MenuContext;

  beforeEach(() => {
    mockRenderer = new MenuRenderer();
    vi.spyOn(mockRenderer, 'clearScreen').mockImplementation(() => {});
    vi.spyOn(mockRenderer, 'showHeader').mockImplementation(() => {});
    vi.spyOn(mockRenderer, 'showStatus').mockImplementation(() => {});
    vi.spyOn(mockRenderer, 'pressEnterToContinue').mockResolvedValue();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'clear').mockImplementation(() => {});

    mockContext = {
      config: {
        connection: { url: 'postgresql://localhost:5432/test' },
        isolation: {
          strategy: 'schema',
          schemaNameTemplate: (id: string) => `tenant_${id}`,
        },
        schemas: { tenant: {} },
      } as any,
      migrationsFolder: './migrations',
      tenantDiscovery: async () => ['t1', 't2'],
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('StatusScreen', () => {
    it('should be instantiable', () => {
      const screen = new StatusScreen(mockContext, mockRenderer);
      expect(screen).toBeInstanceOf(StatusScreen);
    });

    it('should show warning when no tenants found', async () => {
      const { select } = await import('@inquirer/prompts');
      const screen = new StatusScreen(mockContext, mockRenderer);

      const action = await screen.show([]);

      expect(mockRenderer.showStatus).toHaveBeenCalledWith('No tenants found', 'warning');
      expect(action.type).toBe('back');
    });
  });

  describe('MigrationsScreen', () => {
    it('should be instantiable', () => {
      const screen = new MigrationsScreen(mockContext, mockRenderer);
      expect(screen).toBeInstanceOf(MigrationsScreen);
    });

    it('should show success when all tenants up to date', async () => {
      const screen = new MigrationsScreen(mockContext, mockRenderer);
      const statuses: TenantMigrationStatus[] = [
        {
          tenantId: 't1',
          schemaName: 's1',
          status: 'ok',
          appliedCount: 5,
          pendingCount: 0,
          pendingMigrations: [],
          appliedMigrations: [],
        },
      ];

      const action = await screen.show(statuses);

      expect(mockRenderer.showStatus).toHaveBeenCalledWith('All tenants are up to date', 'success');
      expect(action.type).toBe('back');
    });
  });

  describe('TenantsScreen', () => {
    it('should be instantiable', () => {
      const screen = new TenantsScreen(mockContext, mockRenderer);
      expect(screen).toBeInstanceOf(TenantsScreen);
    });

    it('should show warning when no tenants to drop', async () => {
      const screen = new TenantsScreen(mockContext, mockRenderer);

      const action = await screen.showDrop([]);

      expect(mockRenderer.showStatus).toHaveBeenCalledWith('No tenants found', 'warning');
      expect(action.type).toBe('back');
    });
  });

  describe('SeedingScreen', () => {
    it('should be instantiable', () => {
      const screen = new SeedingScreen(mockContext, mockRenderer);
      expect(screen).toBeInstanceOf(SeedingScreen);
    });

    it('should show warning when no tenants found', async () => {
      const screen = new SeedingScreen(mockContext, mockRenderer);

      const action = await screen.show([]);

      expect(mockRenderer.showStatus).toHaveBeenCalledWith('No tenants found', 'warning');
      expect(action.type).toBe('back');
    });
  });

  describe('GenerateScreen', () => {
    it('should be instantiable', () => {
      const screen = new GenerateScreen(mockContext, mockRenderer);
      expect(screen).toBeInstanceOf(GenerateScreen);
    });
  });
});
