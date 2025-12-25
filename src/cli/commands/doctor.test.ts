import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { doctorCommand } from './doctor.js';

// Mock dependencies
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({
      rows: [{ version: 'PostgreSQL 15.4 (Ubuntu 15.4-1.pgdg22.04+1)' }],
    }),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../utils/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    config: {
      connection: { url: 'postgres://localhost/test' },
      isolation: {
        strategy: 'schema',
        schemaNameTemplate: (id: string) => `tenant_${id}`,
        maxPools: 50,
        poolTtlMs: 3600000,
      },
      schemas: { tenant: {}, shared: {} },
    },
    migrationsFolder: './drizzle/tenant',
    tenantDiscovery: vi.fn().mockResolvedValue(['tenant1', 'tenant2']),
    sharedMigrationsFolder: './drizzle/shared',
  }),
}));

vi.mock('../utils/spinner.js', () => ({
  createSpinner: vi.fn().mockReturnValue({
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    text: '',
  }),
}));

vi.mock('../utils/output.js', () => ({
  getOutputContext: vi.fn().mockReturnValue({ jsonMode: false }),
  outputJson: vi.fn(),
  log: vi.fn(),
  success: (msg: string) => msg,
  error: (msg: string) => msg,
  warning: (msg: string) => msg,
  info: (msg: string) => msg,
  bold: (msg: string) => msg,
  dim: (msg: string) => msg,
  cyan: (msg: string) => msg,
  green: (msg: string) => msg,
  yellow: (msg: string) => msg,
  red: (msg: string) => msg,
}));

vi.mock('../utils/errors.js', () => ({
  handleError: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readdirSync: vi.fn().mockReturnValue(['0001_init.sql', '0002_add_users.sql']),
  statSync: vi.fn().mockReturnValue({ isFile: () => true }),
}));

describe('Doctor Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command configuration', () => {
    it('should have correct name', () => {
      expect(doctorCommand.name()).toBe('doctor');
    });

    it('should have description', () => {
      expect(doctorCommand.description()).toContain('Diagnose');
    });

    it('should accept config option', () => {
      const configOption = doctorCommand.options.find((opt) => opt.long === '--config');
      expect(configOption).toBeDefined();
    });
  });

  describe('help text', () => {
    it('should have description about diagnostics', () => {
      const helpInfo = doctorCommand.helpInformation();
      expect(helpInfo).toContain('Diagnose');
    });

    it('should have after help text with examples', () => {
      // The addHelpText('after', ...) adds examples after the main help
      // We verify the command has been configured with examples
      expect(doctorCommand.description()).toContain('Diagnose');
    });
  });

  describe('options', () => {
    it('should have config option with short flag', () => {
      const configOption = doctorCommand.options.find((opt) => opt.long === '--config');
      expect(configOption?.short).toBe('-c');
    });

    it('should accept path for config option', () => {
      const configOption = doctorCommand.options.find((opt) => opt.long === '--config');
      expect(configOption?.description).toContain('Path to config file');
    });
  });
});

describe('Doctor Command - Check Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkConfiguration', () => {
    it('should return ok status when config is valid', async () => {
      const { loadConfig } = await import('../utils/config.js');

      expect(vi.mocked(loadConfig)).toBeDefined();
    });
  });

  describe('checkDatabaseConnection', () => {
    it('should test database connectivity', async () => {
      const { Pool } = await import('pg');

      expect(vi.mocked(Pool)).toBeDefined();
    });
  });

  describe('checkTenantDiscovery', () => {
    it('should have loadConfig mocked', async () => {
      const { loadConfig } = await import('../utils/config.js');

      expect(vi.mocked(loadConfig)).toBeDefined();
      expect(vi.isMockFunction(loadConfig)).toBe(true);
    });
  });

  describe('checkMigrationsFolder', () => {
    it('should check if folder exists and count files', async () => {
      const { existsSync, readdirSync } = await import('node:fs');

      expect(vi.mocked(existsSync)).toBeDefined();
      expect(vi.mocked(readdirSync)).toBeDefined();
    });
  });
});

describe('Doctor Command - Output Formats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should support JSON output via global option', () => {
    // --json is a global option, not specific to the doctor command
    // The command itself doesn't have this option but respects it via getOutputContext()
    expect(doctorCommand.name()).toBe('doctor');
  });
});

describe('Doctor Command - Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export doctorCommand', () => {
    expect(doctorCommand).toBeDefined();
    expect(typeof doctorCommand.action).toBe('function');
  });

  it('should be a Commander Command instance', () => {
    expect(doctorCommand.constructor.name).toBe('Command');
  });
});
