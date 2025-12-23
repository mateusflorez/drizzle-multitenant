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

export interface LoadedConfig {
  config: Config<Record<string, unknown>, Record<string, unknown>>;
  migrationsFolder?: string;
  tenantDiscovery?: () => Promise<string[]>;
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

  return {
    config: exported,
    migrationsFolder: exported.migrations?.tenantFolder,
    tenantDiscovery: exported.migrations?.tenantDiscovery,
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
