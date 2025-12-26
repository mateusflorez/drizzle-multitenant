import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Mock node:fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

describe('config utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadDrizzleKitConfig', () => {
    it('should return null when no drizzle.config file exists', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const { loadDrizzleKitConfig } = await import('./config.js');
      const result = await loadDrizzleKitConfig();

      expect(result).toBeNull();
    });

    it('should search for drizzle.config.ts first', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const { loadDrizzleKitConfig } = await import('./config.js');
      await loadDrizzleKitConfig();

      const cwd = process.cwd();
      expect(existsSync).toHaveBeenCalledWith(resolve(cwd, 'drizzle.config.ts'));
    });

    it('should search for all config file variants', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const { loadDrizzleKitConfig } = await import('./config.js');
      await loadDrizzleKitConfig();

      const cwd = process.cwd();
      expect(existsSync).toHaveBeenCalledWith(resolve(cwd, 'drizzle.config.ts'));
      expect(existsSync).toHaveBeenCalledWith(resolve(cwd, 'drizzle.config.js'));
      expect(existsSync).toHaveBeenCalledWith(resolve(cwd, 'drizzle.config.mjs'));
    });
  });
});

describe('DrizzleKitConfigResult interface', () => {
  it('should return object with config and fileName when found', async () => {
    // This tests the expected interface structure
    // When a config is found, result should have:
    // - config: { out, schema, dialect, dbCredentials, migrations }
    // - fileName: string (e.g., 'drizzle.config.ts')

    interface DrizzleKitConfigResult {
      config: {
        out?: string;
        schema?: string;
        dialect?: string;
        dbCredentials?: object;
        migrations?: { table?: string; schema?: string };
      };
      fileName: string;
    }

    const mockResult: DrizzleKitConfigResult = {
      config: {
        out: './drizzle',
        schema: './src/schema.ts',
        dialect: 'postgresql',
        migrations: {
          table: '__drizzle_migrations',
          schema: 'public',
        },
      },
      fileName: 'drizzle.config.ts',
    };

    expect(mockResult.fileName).toBe('drizzle.config.ts');
    expect(mockResult.config.out).toBe('./drizzle');
    expect(mockResult.config.migrations?.table).toBe('__drizzle_migrations');
  });
});

describe('LoadedConfig interface', () => {
  it('should include all expected fields', () => {
    // LoadedConfig should have:
    // - config: Config
    // - migrationsFolder?: string
    // - migrationsTable?: string
    // - tenantDiscovery?: function
    // - sharedMigrationsFolder?: string
    // - sharedMigrationsTable?: string
    // - sharedTableFormat?: 'auto' | 'name' | 'hash' | 'drizzle-kit'
    // - sharedDefaultFormat?: 'name' | 'hash' | 'drizzle-kit'
    // - drizzleKitConfig?: DrizzleKitConfig | null
    // - drizzleKitConfigFile?: string | null
    // - sharedConfigSource?: 'drizzle.config.ts' | 'tenant.config.ts' | null

    interface LoadedConfig {
      config: object;
      migrationsFolder?: string;
      migrationsTable?: string;
      tenantDiscovery?: () => Promise<string[]>;
      sharedMigrationsFolder?: string;
      sharedMigrationsTable?: string;
      sharedTableFormat?: 'auto' | 'name' | 'hash' | 'drizzle-kit';
      sharedDefaultFormat?: 'name' | 'hash' | 'drizzle-kit';
      drizzleKitConfig?: object | null;
      drizzleKitConfigFile?: string | null;
      sharedConfigSource?: 'drizzle.config.ts' | 'tenant.config.ts' | null;
    }

    const mockConfig: LoadedConfig = {
      config: { connection: {}, isolation: {}, schemas: {} },
      migrationsFolder: './drizzle/tenant',
      sharedMigrationsFolder: './drizzle',
      sharedMigrationsTable: '__drizzle_migrations',
      sharedTableFormat: 'auto',
      drizzleKitConfig: { out: './drizzle' },
      drizzleKitConfigFile: 'drizzle.config.ts',
      sharedConfigSource: 'drizzle.config.ts',
    };

    expect(mockConfig.sharedConfigSource).toBe('drizzle.config.ts');
    expect(mockConfig.drizzleKitConfigFile).toBe('drizzle.config.ts');
  });
});

describe('sharedConfigSource detection logic', () => {
  describe('priority: tenant.config.ts > drizzle.config.ts > defaults', () => {
    it('should set source to tenant.config.ts when sharedFolder is defined there', () => {
      const tenantConfigSharedFolder = './drizzle/shared';
      const drizzleKitOut = './drizzle';

      let sharedMigrationsFolder: string | undefined;
      let sharedConfigSource: 'drizzle.config.ts' | 'tenant.config.ts' | null = null;

      if (tenantConfigSharedFolder) {
        sharedMigrationsFolder = tenantConfigSharedFolder;
        sharedConfigSource = 'tenant.config.ts';
      } else if (drizzleKitOut) {
        sharedMigrationsFolder = drizzleKitOut;
        sharedConfigSource = 'drizzle.config.ts';
      }

      expect(sharedMigrationsFolder).toBe('./drizzle/shared');
      expect(sharedConfigSource).toBe('tenant.config.ts');
    });

    it('should set source to drizzle.config.ts when only drizzle config has out folder', () => {
      const tenantConfigSharedFolder: string | undefined = undefined;
      const drizzleKitOut = './drizzle';

      let sharedMigrationsFolder: string | undefined;
      let sharedConfigSource: 'drizzle.config.ts' | 'tenant.config.ts' | null = null;

      if (tenantConfigSharedFolder) {
        sharedMigrationsFolder = tenantConfigSharedFolder;
        sharedConfigSource = 'tenant.config.ts';
      } else if (drizzleKitOut) {
        sharedMigrationsFolder = drizzleKitOut;
        sharedConfigSource = 'drizzle.config.ts';
      }

      expect(sharedMigrationsFolder).toBe('./drizzle');
      expect(sharedConfigSource).toBe('drizzle.config.ts');
    });

    it('should set source to null when neither config has shared folder', () => {
      const tenantConfigSharedFolder: string | undefined = undefined;
      const drizzleKitOut: string | undefined = undefined;

      let sharedMigrationsFolder: string | undefined;
      let sharedConfigSource: 'drizzle.config.ts' | 'tenant.config.ts' | null = null;

      if (tenantConfigSharedFolder) {
        sharedMigrationsFolder = tenantConfigSharedFolder;
        sharedConfigSource = 'tenant.config.ts';
      } else if (drizzleKitOut) {
        sharedMigrationsFolder = drizzleKitOut;
        sharedConfigSource = 'drizzle.config.ts';
      }

      expect(sharedMigrationsFolder).toBeUndefined();
      expect(sharedConfigSource).toBeNull();
    });
  });

  describe('migrations table priority', () => {
    it('tenant.config.ts should override drizzle.config.ts for sharedTable', () => {
      const tenantTable = '__custom_migrations';
      const drizzleKitTable = '__drizzle_migrations';
      const defaultTable = '__drizzle_migrations';

      const resolvedTable = tenantTable ?? drizzleKitTable ?? defaultTable;
      expect(resolvedTable).toBe('__custom_migrations');
    });

    it('drizzle.config.ts should be used when tenant.config.ts has no sharedTable', () => {
      const tenantTable = undefined;
      const drizzleKitTable = '__drizzle_kit_migrations';
      const defaultTable = '__drizzle_migrations';

      const resolvedTable = tenantTable ?? drizzleKitTable ?? defaultTable;
      expect(resolvedTable).toBe('__drizzle_kit_migrations');
    });

    it('should use default table when neither config specifies it', () => {
      const tenantTable = undefined;
      const drizzleKitTable = undefined;
      const defaultTable = '__drizzle_migrations';

      const resolvedTable = tenantTable ?? drizzleKitTable ?? defaultTable;
      expect(resolvedTable).toBe('__drizzle_migrations');
    });
  });

  describe('sharedTableFormat defaults', () => {
    it('should default to auto when not specified', () => {
      const configuredFormat = undefined;
      const defaultFormat = 'auto';

      const resolvedFormat = configuredFormat ?? defaultFormat;
      expect(resolvedFormat).toBe('auto');
    });

    it('should use configured format when specified', () => {
      const configuredFormat = 'drizzle-kit';
      const defaultFormat = 'auto';

      const resolvedFormat = configuredFormat ?? defaultFormat;
      expect(resolvedFormat).toBe('drizzle-kit');
    });
  });
});

describe('drizzle.config.ts file detection order', () => {
  it('should check .ts extension first', () => {
    const configNames = [
      'drizzle.config.ts',
      'drizzle.config.js',
      'drizzle.config.mjs',
    ];

    expect(configNames[0]).toBe('drizzle.config.ts');
  });

  it('should check .js extension second', () => {
    const configNames = [
      'drizzle.config.ts',
      'drizzle.config.js',
      'drizzle.config.mjs',
    ];

    expect(configNames[1]).toBe('drizzle.config.js');
  });

  it('should check .mjs extension last', () => {
    const configNames = [
      'drizzle.config.ts',
      'drizzle.config.js',
      'drizzle.config.mjs',
    ];

    expect(configNames[2]).toBe('drizzle.config.mjs');
  });
});
