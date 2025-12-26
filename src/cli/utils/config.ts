import { pathToFileURL } from 'node:url';
import { resolve, extname } from 'node:path';
import { existsSync } from 'node:fs';
import type { Config } from '../../types.js';

const CONFIG_FILE_NAMES = [
  'tenant.config.ts',
  'tenant.config.js',
  'tenant.config.mjs',
  'drizzle-multitenant.config.ts',
  'drizzle-multitenant.config.js',
  'drizzle-multitenant.config.mjs',
];

const DRIZZLE_KIT_CONFIG_NAMES = [
  'drizzle.config.ts',
  'drizzle.config.js',
  'drizzle.config.mjs',
];

/**
 * Drizzle-kit configuration structure
 * @see https://orm.drizzle.team/kit-docs/config-reference
 */
export interface DrizzleKitConfig {
  /** Output folder for migrations */
  out?: string;
  /** Schema file path */
  schema?: string;
  /** Database dialect */
  dialect?: string;
  /** Database credentials */
  dbCredentials?: {
    url?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
  /** Migrations configuration */
  migrations?: {
    /** Custom migrations table name */
    table?: string;
    /** Schema where migrations table is stored */
    schema?: string;
  };
}

export interface LoadedConfig {
  config: Config<Record<string, unknown>, Record<string, unknown>>;
  migrationsFolder?: string;
  migrationsTable?: string;
  tenantDiscovery?: () => Promise<string[]>;
  /** Path to shared schema migrations folder */
  sharedMigrationsFolder?: string;
  /** Table name for tracking shared migrations */
  sharedMigrationsTable?: string;
  /** Table format for shared migrations detection */
  sharedTableFormat?: 'auto' | 'name' | 'hash' | 'drizzle-kit';
  /** Default format when creating new shared migrations table */
  sharedDefaultFormat?: 'name' | 'hash' | 'drizzle-kit';
  /** Drizzle-kit config if found */
  drizzleKitConfig?: DrizzleKitConfig | null;
  /** Name of the drizzle-kit config file found (e.g., 'drizzle.config.ts') */
  drizzleKitConfigFile?: string | null;
  /** Source of shared folder configuration */
  sharedConfigSource?: 'drizzle.config.ts' | 'tenant.config.ts' | null;
}

/**
 * Load configuration from file
 */
export async function loadConfig(configPath?: string): Promise<LoadedConfig> {
  const cwd = process.cwd();

  let configFile: string | undefined;

  if (configPath) {
    configFile = resolve(cwd, configPath);
    if (!existsSync(configFile)) {
      throw new Error(`Config file not found: ${configFile}`);
    }
  } else {
    // Search for config file
    for (const name of CONFIG_FILE_NAMES) {
      const path = resolve(cwd, name);
      if (existsSync(path)) {
        configFile = path;
        break;
      }
    }
  }

  if (!configFile) {
    throw new Error(
      'Config file not found. Create a tenant.config.ts or use --config flag.'
    );
  }

  // Handle TypeScript files
  const ext = extname(configFile);
  if (ext === '.ts') {
    // Register ts-node or tsx for TypeScript support
    await registerTypeScript();
  }

  // Import the config
  const configUrl = pathToFileURL(configFile).href;
  const module = await import(configUrl);
  const exported = module.default ?? module;

  if (!exported.connection || !exported.isolation || !exported.schemas) {
    throw new Error(
      'Invalid config file. Expected an object with connection, isolation, and schemas properties.'
    );
  }

  // Load drizzle-kit config for shared schema settings (if exists)
  const drizzleKitResult = await loadDrizzleKitConfig();

  // Priority: tenant.config.ts > drizzle.config.ts > defaults
  // Track the source of the shared folder configuration
  let sharedMigrationsFolder: string | undefined;
  let sharedConfigSource: 'drizzle.config.ts' | 'tenant.config.ts' | null = null;

  if (exported.migrations?.sharedFolder) {
    sharedMigrationsFolder = exported.migrations.sharedFolder;
    sharedConfigSource = 'tenant.config.ts';
  } else if (drizzleKitResult?.config.out) {
    sharedMigrationsFolder = drizzleKitResult.config.out;
    sharedConfigSource = 'drizzle.config.ts';
  }

  const sharedMigrationsTable =
    exported.migrations?.sharedTable ??
    drizzleKitResult?.config.migrations?.table ??
    '__drizzle_migrations';
  const sharedTableFormat = exported.migrations?.sharedTableFormat ?? 'auto';
  const sharedDefaultFormat = exported.migrations?.sharedDefaultFormat;

  return {
    config: exported,
    migrationsFolder: exported.migrations?.tenantFolder ?? exported.migrations?.folder,
    migrationsTable: exported.migrations?.migrationsTable ?? exported.migrations?.table,
    tenantDiscovery: exported.migrations?.tenantDiscovery,
    sharedMigrationsFolder,
    sharedMigrationsTable,
    sharedTableFormat,
    sharedDefaultFormat,
    drizzleKitConfig: drizzleKitResult?.config ?? null,
    drizzleKitConfigFile: drizzleKitResult?.fileName ?? null,
    sharedConfigSource,
  };
}

/**
 * Register TypeScript loader
 */
async function registerTypeScript(): Promise<void> {
  try {
    // Try tsx first (faster)
    await import('tsx/esm');
  } catch {
    try {
      // Fall back to ts-node
      await import('ts-node/esm');
    } catch {
      throw new Error(
        'TypeScript config requires tsx or ts-node. Install with: npm install -D tsx'
      );
    }
  }
}

/**
 * Result of loading drizzle-kit configuration
 */
export interface DrizzleKitConfigResult {
  config: DrizzleKitConfig;
  fileName: string;
}

/**
 * Load drizzle-kit configuration for shared schema settings
 *
 * Searches for drizzle.config.ts/js/mjs in the current working directory.
 * If found, returns the parsed configuration which can be used to auto-detect
 * shared migrations folder and table settings.
 *
 * @example
 * ```typescript
 * const result = await loadDrizzleKitConfig();
 * if (result) {
 *   console.log('Found:', result.fileName);
 *   console.log('Shared migrations folder:', result.config.out);
 *   console.log('Migrations table:', result.config.migrations?.table);
 * }
 * ```
 *
 * @returns DrizzleKitConfigResult if found, null otherwise
 */
export async function loadDrizzleKitConfig(): Promise<DrizzleKitConfigResult | null> {
  const cwd = process.cwd();

  for (const name of DRIZZLE_KIT_CONFIG_NAMES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) {
      const ext = extname(path);
      if (ext === '.ts') {
        await registerTypeScript();
      }

      try {
        const configUrl = pathToFileURL(path).href;
        const module = await import(configUrl);
        const exported = module.default ?? module;

        // drizzle-kit uses defineConfig() which returns the config object directly
        return {
          config: {
            out: exported.out,
            schema: exported.schema,
            dialect: exported.dialect,
            dbCredentials: exported.dbCredentials,
            migrations: exported.migrations,
          },
          fileName: name,
        };
      } catch (error) {
        // Config file exists but failed to load - log warning and continue
        console.warn(
          `Warning: Found ${name} but failed to load it:`,
          error instanceof Error ? error.message : error
        );
        return null;
      }
    }
  }

  return null;
}

/**
 * Resolve migrations folder path
 */
export function resolveMigrationsFolder(folder?: string): string {
  const cwd = process.cwd();
  const defaultFolder = './drizzle/tenant';

  const resolved = resolve(cwd, folder ?? defaultFolder);

  if (!existsSync(resolved)) {
    throw new Error(`Migrations folder not found: ${resolved}`);
  }

  return resolved;
}
