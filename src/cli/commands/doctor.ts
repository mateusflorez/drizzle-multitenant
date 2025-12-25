import { Command } from 'commander';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../utils/config.js';
import { createSpinner } from '../utils/spinner.js';
import { handleError } from '../utils/errors.js';
import {
  getOutputContext,
  outputJson,
  log,
  success,
  error,
  warning,
  bold,
  dim,
  cyan,
  green,
  yellow,
  red,
} from '../utils/output.js';
import type { GlobalOptions } from '../types.js';
import type { DoctorJsonOutput, DoctorCheck, DoctorRecommendation } from '../types.js';

/**
 * Options for the doctor command
 */
interface DoctorOptions extends GlobalOptions {
  config?: string;
}

/**
 * Database version info
 */
interface DatabaseInfo {
  version: string;
  latencyMs: number;
}

/**
 * Folder info for migrations
 */
interface FolderInfo {
  exists: boolean;
  path: string;
  fileCount: number;
}

/**
 * Doctor command - diagnose configuration and environment issues
 */
export const doctorCommand = new Command('doctor')
  .description('Diagnose configuration and environment issues')
  .option('-c, --config <path>', 'Path to config file')
  .addHelpText(
    'after',
    `
Examples:
  $ drizzle-multitenant doctor
  $ drizzle-multitenant doctor --json
  $ drizzle-multitenant doctor --config ./custom.config.ts
`
  )
  .action(async (options: DoctorOptions) => {
    const ctx = getOutputContext();
    const spinner = createSpinner('Running diagnostics...');

    const checks: DoctorCheck[] = [];
    const recommendations: DoctorRecommendation[] = [];
    const startTime = Date.now();

    try {
      spinner.start();

      // 1. Check configuration file
      spinner.text = 'Checking configuration...';
      const configCheck = await checkConfiguration(options.config);
      checks.push(configCheck.check);
      if (configCheck.recommendation) {
        recommendations.push(configCheck.recommendation);
      }

      if (!configCheck.config) {
        spinner.fail('Configuration check failed');
        if (ctx.jsonMode) {
          outputJson<DoctorJsonOutput>({
            healthy: false,
            checks,
            recommendations,
            durationMs: Date.now() - startTime,
          });
        }
        return;
      }

      const { config, migrationsFolder, tenantDiscovery, sharedMigrationsFolder } =
        configCheck.config;

      // 2. Check database connection
      spinner.text = 'Checking database connection...';
      const dbCheck = await checkDatabaseConnection(config.connection.url);
      checks.push(dbCheck.check);
      if (dbCheck.recommendation) {
        recommendations.push(dbCheck.recommendation);
      }

      // 3. Check tenant discovery
      spinner.text = 'Checking tenant discovery...';
      const discoveryCheck = await checkTenantDiscovery(tenantDiscovery);
      checks.push(discoveryCheck.check);
      if (discoveryCheck.recommendation) {
        recommendations.push(discoveryCheck.recommendation);
      }

      // 4. Check migrations folder
      spinner.text = 'Checking migrations folder...';
      const migrationsFolderCheck = checkMigrationsFolder(migrationsFolder, 'tenant');
      checks.push(migrationsFolderCheck.check);
      if (migrationsFolderCheck.recommendation) {
        recommendations.push(migrationsFolderCheck.recommendation);
      }

      // 5. Check shared migrations folder (optional)
      spinner.text = 'Checking shared migrations folder...';
      const sharedMigrationsFolderCheck = checkMigrationsFolder(sharedMigrationsFolder, 'shared');
      checks.push(sharedMigrationsFolderCheck.check);
      if (sharedMigrationsFolderCheck.recommendation) {
        recommendations.push(sharedMigrationsFolderCheck.recommendation);
      }

      // 6. Check schema isolation
      spinner.text = 'Checking schema isolation...';
      const isolationCheck = checkSchemaIsolation(config.isolation);
      checks.push(isolationCheck.check);

      // 7. Check pool configuration
      spinner.text = 'Checking pool configuration...';
      const poolCheck = checkPoolConfiguration(
        config.isolation,
        discoveryCheck.tenantCount
      );
      checks.push(poolCheck.check);
      if (poolCheck.recommendation) {
        recommendations.push(poolCheck.recommendation);
      }

      spinner.succeed('Diagnostics complete');

      const hasWarnings = checks.some((c) => c.status === 'warn');
      const hasErrors = checks.some((c) => c.status === 'error');

      // JSON output
      if (ctx.jsonMode) {
        const jsonOutput: DoctorJsonOutput = {
          healthy: !hasErrors,
          checks,
          recommendations,
          poolConfig: {
            maxPools: config.isolation.maxPools ?? 50,
            poolTtlMs: config.isolation.poolTtlMs ?? 3600000,
          },
          durationMs: Date.now() - startTime,
        };

        if (dbCheck.dbInfo) {
          jsonOutput.database = dbCheck.dbInfo;
        }
        if (discoveryCheck.tenantCount !== undefined) {
          jsonOutput.tenantCount = discoveryCheck.tenantCount;
        }

        outputJson<DoctorJsonOutput>(jsonOutput);
        return;
      }

      // Human-readable output
      log('\n' + bold(cyan('🔍 drizzle-multitenant Doctor')) + '\n');

      // Print checks
      for (const check of checks) {
        const icon = getStatusIcon(check.status);
        const statusColor = getStatusColor(check.status);
        log(`${icon} ${statusColor(check.name)}: ${check.message}`);
        if (check.details) {
          log(dim(`   ${check.details}`));
        }
      }

      // Print recommendations if any
      if (recommendations.length > 0) {
        log('\n' + bold(yellow('⚠ Recommendations:')) + '\n');
        recommendations.forEach((rec, index) => {
          log(`  ${index + 1}. ${rec.message}`);
          if (rec.action) {
            log(dim(`     → ${rec.action}`));
          }
        });
      }

      // Print summary
      log('\n' + bold('📊 Summary:'));
      if (dbCheck.dbInfo) {
        log(`  Database: PostgreSQL ${dbCheck.dbInfo.version} (${dbCheck.dbInfo.latencyMs}ms latency)`);
      }
      if (discoveryCheck.tenantCount !== undefined) {
        log(`  Tenants: ${discoveryCheck.tenantCount} discovered`);
      }
      log(`  Pool: max=${config.isolation.maxPools ?? 50}, ttl=${formatMs(config.isolation.poolTtlMs ?? 3600000)}`);
      log(`  Isolation: ${config.isolation.strategy}-based`);

      // Print overall status
      log('');
      if (hasErrors) {
        log(error(bold('✗ Some checks failed. Please review the issues above.')));
        process.exit(1);
      } else if (hasWarnings) {
        log(warning(bold('⚠ All checks passed with warnings.')));
      } else {
        log(success(bold('✓ All checks passed!')));
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      handleError(err);
    }
  });

/**
 * Check configuration file
 */
async function checkConfiguration(configPath?: string): Promise<{
  check: DoctorCheck;
  recommendation?: DoctorRecommendation;
  config?: Awaited<ReturnType<typeof loadConfig>>;
}> {
  try {
    const config = await loadConfig(configPath);

    return {
      check: {
        name: 'Configuration',
        status: 'ok',
        message: 'Configuration file found and valid',
        details: configPath ?? 'tenant.config.ts',
      },
      config,
    };
  } catch (err) {
    return {
      check: {
        name: 'Configuration',
        status: 'error',
        message: (err as Error).message,
      },
      recommendation: {
        priority: 'high',
        message: 'Configuration file not found or invalid',
        action: 'Run `npx drizzle-multitenant init` to create a configuration file',
      },
    };
  }
}

/**
 * Check database connection
 */
async function checkDatabaseConnection(connectionUrl: string): Promise<{
  check: DoctorCheck;
  recommendation?: DoctorRecommendation;
  dbInfo?: DatabaseInfo;
}> {
  const pool = new Pool({ connectionString: connectionUrl });
  const startTime = Date.now();

  try {
    const result = await pool.query('SELECT version()');
    const latencyMs = Date.now() - startTime;

    // Parse PostgreSQL version from "PostgreSQL 15.4 (Ubuntu 15.4-1.pgdg22.04+1) on x86_64..."
    const versionMatch = result.rows[0].version.match(/PostgreSQL (\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    await pool.end();

    return {
      check: {
        name: 'Database Connection',
        status: 'ok',
        message: `PostgreSQL ${version} connected`,
        details: `Response time: ${latencyMs}ms`,
      },
      dbInfo: { version, latencyMs },
    };
  } catch (err) {
    await pool.end().catch(() => {});

    return {
      check: {
        name: 'Database Connection',
        status: 'error',
        message: (err as Error).message,
      },
      recommendation: {
        priority: 'high',
        message: 'Cannot connect to database',
        action: 'Verify DATABASE_URL is correct and PostgreSQL is running',
      },
    };
  }
}

/**
 * Check tenant discovery
 */
async function checkTenantDiscovery(
  tenantDiscovery?: () => Promise<string[]>
): Promise<{
  check: DoctorCheck;
  recommendation?: DoctorRecommendation;
  tenantCount?: number;
}> {
  if (!tenantDiscovery) {
    return {
      check: {
        name: 'Tenant Discovery',
        status: 'warn',
        message: 'Not configured',
        details: 'migrations.tenantDiscovery is not defined in config',
      },
      recommendation: {
        priority: 'medium',
        message: 'Tenant discovery is not configured',
        action: 'Add tenantDiscovery function to your config for automatic tenant detection',
      },
    };
  }

  try {
    const tenants = await tenantDiscovery();

    if (tenants.length === 0) {
      return {
        check: {
          name: 'Tenant Discovery',
          status: 'warn',
          message: 'No tenants found',
        },
        recommendation: {
          priority: 'low',
          message: 'No tenants discovered',
          action: 'Create a tenant using `npx drizzle-multitenant tenant:create --id=<tenant-id>`',
        },
        tenantCount: 0,
      };
    }

    return {
      check: {
        name: 'Tenant Discovery',
        status: 'ok',
        message: `Found ${tenants.length} tenant(s)`,
      },
      tenantCount: tenants.length,
    };
  } catch (err) {
    return {
      check: {
        name: 'Tenant Discovery',
        status: 'error',
        message: (err as Error).message,
      },
      recommendation: {
        priority: 'high',
        message: 'Tenant discovery function failed',
        action: 'Check your tenantDiscovery implementation for errors',
      },
    };
  }
}

/**
 * Check migrations folder
 */
function checkMigrationsFolder(
  folder: string | undefined,
  type: 'tenant' | 'shared'
): {
  check: DoctorCheck;
  recommendation?: DoctorRecommendation;
  folderInfo?: FolderInfo;
} {
  const name = type === 'tenant' ? 'Migrations Folder' : 'Shared Migrations Folder';

  if (!folder) {
    if (type === 'shared') {
      return {
        check: {
          name,
          status: 'warn',
          message: 'Not configured',
          details: 'sharedMigrationsFolder is not defined in config',
        },
        recommendation: {
          priority: 'low',
          message: 'Shared migrations folder not configured',
          action: 'Add sharedFolder to your migrations config to enable shared schema migrations',
        },
      };
    }

    return {
      check: {
        name,
        status: 'warn',
        message: 'Not configured',
      },
      recommendation: {
        priority: 'medium',
        message: 'Migrations folder not configured',
        action: 'Add migrations.folder or migrations.tenantFolder to your config',
      },
    };
  }

  const resolvedPath = resolve(process.cwd(), folder);

  if (!existsSync(resolvedPath)) {
    return {
      check: {
        name,
        status: 'warn',
        message: 'Folder does not exist',
        details: resolvedPath,
      },
      recommendation: {
        priority: 'medium',
        message: `${type === 'tenant' ? 'Migrations' : 'Shared migrations'} folder not found`,
        action: `Create the folder: mkdir -p ${folder}`,
      },
      folderInfo: { exists: false, path: resolvedPath, fileCount: 0 },
    };
  }

  try {
    const files = readdirSync(resolvedPath).filter(
      (f) => f.endsWith('.sql') && statSync(resolve(resolvedPath, f)).isFile()
    );

    return {
      check: {
        name,
        status: 'ok',
        message: `${files.length} migration file(s)`,
        details: folder,
      },
      folderInfo: { exists: true, path: resolvedPath, fileCount: files.length },
    };
  } catch (err) {
    return {
      check: {
        name,
        status: 'error',
        message: (err as Error).message,
      },
    };
  }
}

/**
 * Check schema isolation configuration
 */
function checkSchemaIsolation(isolation: {
  strategy: string;
  schemaNameTemplate: (tenantId: string) => string;
}): {
  check: DoctorCheck;
} {
  if (isolation.strategy !== 'schema') {
    return {
      check: {
        name: 'Schema Isolation',
        status: 'warn',
        message: `Strategy "${isolation.strategy}" is not yet supported`,
        details: 'Only "schema" strategy is currently supported',
      },
    };
  }

  // Test the schema template function
  try {
    const testSchema = isolation.schemaNameTemplate('test-tenant');
    if (!testSchema || typeof testSchema !== 'string') {
      throw new Error('schemaNameTemplate must return a string');
    }

    return {
      check: {
        name: 'Schema Isolation',
        status: 'ok',
        message: 'schema-based isolation',
        details: `Template: test-tenant → ${testSchema}`,
      },
    };
  } catch (err) {
    return {
      check: {
        name: 'Schema Isolation',
        status: 'error',
        message: (err as Error).message,
      },
    };
  }
}

/**
 * Check pool configuration
 */
function checkPoolConfiguration(
  isolation: { maxPools?: number; poolTtlMs?: number },
  tenantCount?: number
): {
  check: DoctorCheck;
  recommendation?: DoctorRecommendation;
} {
  const maxPools = isolation.maxPools ?? 50;
  const poolTtlMs = isolation.poolTtlMs ?? 3600000;

  const details = `max=${maxPools}, ttl=${formatMs(poolTtlMs)}`;

  // Check if maxPools is sufficient for tenant count
  if (tenantCount !== undefined && tenantCount > maxPools * 0.8) {
    const suggestedMax = Math.ceil(tenantCount * 1.5);

    return {
      check: {
        name: 'Pool Configuration',
        status: 'warn',
        message: 'Pool limit may be insufficient',
        details,
      },
      recommendation: {
        priority: 'medium',
        message: `Current maxPools (${maxPools}) is close to tenant count (${tenantCount})`,
        action: `Consider increasing maxPools to ${suggestedMax} to avoid LRU evictions`,
      },
    };
  }

  return {
    check: {
      name: 'Pool Configuration',
      status: 'ok',
      message: 'Configuration looks good',
      details,
    },
  };
}

/**
 * Get status icon
 */
function getStatusIcon(status: 'ok' | 'warn' | 'error'): string {
  switch (status) {
    case 'ok':
      return green('✓');
    case 'warn':
      return yellow('⚠');
    case 'error':
      return red('✗');
  }
}

/**
 * Get status color function
 */
function getStatusColor(status: 'ok' | 'warn' | 'error'): (text: string) => string {
  switch (status) {
    case 'ok':
      return (text: string) => text;
    case 'warn':
      return yellow;
    case 'error':
      return red;
  }
}

/**
 * Format milliseconds to human-readable string
 */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}min`;
  return `${Math.round(ms / 3600000)}h`;
}
