import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MenuRenderer } from './menu-renderer.js';
import type { TenantMigrationStatus } from '../types.js';

describe('MenuRenderer', () => {
  let renderer: MenuRenderer;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    renderer = new MenuRenderer();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'clear').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('clearScreen', () => {
    it('should call console.clear', () => {
      const clearSpy = vi.spyOn(console, 'clear');
      renderer.clearScreen();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('showHeader', () => {
    it('should render header with title', () => {
      renderer.showHeader('Test Header');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('showStatus', () => {
    it('should render success status', () => {
      renderer.showStatus('Success message', 'success');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should render warning status', () => {
      renderer.showStatus('Warning message', 'warning');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should render error status', () => {
      renderer.showStatus('Error message', 'error');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should render info status by default', () => {
      renderer.showStatus('Info message');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('formatTenantStatus', () => {
    it('should format ok status', () => {
      const result = renderer.formatTenantStatus('ok');
      expect(result).toContain('up to date');
    });

    it('should format behind status', () => {
      const result = renderer.formatTenantStatus('behind');
      expect(result).toContain('pending');
    });

    it('should format error status', () => {
      const result = renderer.formatTenantStatus('error');
      expect(result).toContain('error');
    });
  });

  describe('formatPendingCount', () => {
    it('should format zero count as dim', () => {
      const result = renderer.formatPendingCount(0);
      expect(result).toContain('0');
    });

    it('should format positive count with pending label', () => {
      const result = renderer.formatPendingCount(5);
      expect(result).toContain('5');
      expect(result).toContain('pending');
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(renderer.formatDuration(500)).toBe('500ms');
    });

    it('should format seconds', () => {
      expect(renderer.formatDuration(2500)).toBe('2.5s');
    });

    it('should format minutes and seconds', () => {
      expect(renderer.formatDuration(90000)).toBe('1m 30s');
    });
  });

  describe('getStatusSummary', () => {
    it('should calculate summary from statuses', () => {
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
        {
          tenantId: 't2',
          schemaName: 's2',
          status: 'behind',
          appliedCount: 3,
          pendingCount: 2,
          pendingMigrations: ['m1', 'm2'],
          appliedMigrations: [],
        },
        {
          tenantId: 't3',
          schemaName: 's3',
          status: 'error',
          appliedCount: 0,
          pendingCount: 0,
          pendingMigrations: [],
          appliedMigrations: [],
          error: 'Connection failed',
        },
      ];

      const summary = renderer.getStatusSummary(statuses);

      expect(summary.upToDate).toBe(1);
      expect(summary.behind).toBe(1);
      expect(summary.error).toBe(1);
      expect(summary.totalPending).toBe(2);
    });

    it('should return zeros for empty array', () => {
      const summary = renderer.getStatusSummary([]);

      expect(summary.upToDate).toBe(0);
      expect(summary.behind).toBe(0);
      expect(summary.error).toBe(0);
      expect(summary.totalPending).toBe(0);
    });
  });

  describe('createStatusTable', () => {
    it('should create a table with tenant data', () => {
      const statuses: TenantMigrationStatus[] = [
        {
          tenantId: 'tenant-1',
          schemaName: 'tenant_1',
          status: 'ok',
          appliedCount: 5,
          pendingCount: 0,
          pendingMigrations: [],
          appliedMigrations: [],
        },
      ];

      const table = renderer.createStatusTable(statuses);
      expect(table).toBeDefined();
      expect(table.toString()).toContain('tenant-1');
    });
  });

  describe('showProgress', () => {
    it('should show completed progress', () => {
      renderer.showProgress('tenant-1', 'completed');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('tenant-1'));
    });

    it('should show failed progress', () => {
      renderer.showProgress('tenant-1', 'failed');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('tenant-1'));
    });

    it('should show migrating progress with migration name', () => {
      renderer.showProgress('tenant-1', 'migrating', '0001_init.sql');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('0001_init.sql'));
    });
  });

  describe('showError', () => {
    it('should show error message', () => {
      renderer.showError('Something went wrong');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'));
    });
  });

  describe('showResults', () => {
    it('should show success results', () => {
      const results = {
        succeeded: 5,
        failed: 0,
        details: [],
      };

      renderer.showResults(results, 1000);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should show failed results with details', () => {
      const results = {
        succeeded: 3,
        failed: 2,
        details: [
          { tenantId: 't1', success: true },
          { tenantId: 't2', success: false, error: 'Failed' },
          { tenantId: 't3', success: false, error: 'Timeout' },
        ],
      };

      renderer.showResults(results, 2000);
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
