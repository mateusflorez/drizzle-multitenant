import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chalk from 'chalk';
import {
  showBanner,
  showHeader,
  showStatus,
  clearScreen,
  formatTenantStatus,
  formatPendingCount,
  formatDuration,
} from './banner.js';

describe('CLI UI Banner', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let clearSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    clearSpy = vi.spyOn(console, 'clear').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    clearSpy.mockRestore();
  });

  describe('showBanner', () => {
    it('should display the banner', () => {
      showBanner();
      expect(consoleSpy).toHaveBeenCalled();
      // Check that banner contains the title
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Drizzle Multitenant CLI');
    });
  });

  describe('showHeader', () => {
    it('should display a header with title', () => {
      showHeader('Test Header');
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Test Header');
    });
  });

  describe('showStatus', () => {
    it('should display success status', () => {
      showStatus('Operation successful', 'success');
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('Operation successful');
    });

    it('should display warning status', () => {
      showStatus('Something went wrong', 'warning');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should display error status', () => {
      showStatus('Error occurred', 'error');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should display info status', () => {
      showStatus('Information', 'info');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should default to info status', () => {
      showStatus('Default info');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('clearScreen', () => {
    it('should call console.clear', () => {
      clearScreen();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('formatTenantStatus', () => {
    it('should format ok status', () => {
      const result = formatTenantStatus('ok');
      expect(result).toContain('up to date');
    });

    it('should format behind status', () => {
      const result = formatTenantStatus('behind');
      expect(result).toContain('pending');
    });

    it('should format error status', () => {
      const result = formatTenantStatus('error');
      expect(result).toContain('error');
    });
  });

  describe('formatPendingCount', () => {
    it('should format zero count as dimmed', () => {
      const result = formatPendingCount(0);
      expect(result).toBe(chalk.dim('0'));
    });

    it('should format non-zero count with yellow', () => {
      const result = formatPendingCount(5);
      expect(result).toBe(chalk.yellow('5 pending'));
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1.0s');
      expect(formatDuration(5500)).toBe('5.5s');
      expect(formatDuration(59999)).toBe('60.0s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });
  });
});
