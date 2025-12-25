import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { interactiveCommand } from './interactive.js';

// Mock the menu module
vi.mock('../ui/menu.js', () => ({
  mainMenu: vi.fn().mockResolvedValue(undefined),
}));

describe('Interactive Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have correct name', () => {
      expect(interactiveCommand.name()).toBe('interactive');
    });

    it('should have alias i', () => {
      expect(interactiveCommand.alias()).toBe('i');
    });

    it('should have description', () => {
      expect(interactiveCommand.description()).toContain('interactive');
    });

    it('should accept config option', () => {
      const configOption = interactiveCommand.options.find(
        (opt) => opt.long === '--config'
      );
      expect(configOption).toBeDefined();
    });
  });

  describe('help text', () => {
    it('should have description mentioning interactive TUI', () => {
      const helpInfo = interactiveCommand.helpInformation();
      expect(helpInfo).toContain('interactive TUI');
    });

    it('should show usage with alias', () => {
      const helpInfo = interactiveCommand.helpInformation();
      expect(helpInfo).toContain('interactive|i');
    });
  });
});
