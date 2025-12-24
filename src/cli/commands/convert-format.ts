import { Command } from 'commander';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import {
  loadConfig,
  resolveMigrationsFolder,
  createSpinner,
  success,
  error,
  warning,
  bold,
  dim,
} from '../utils/index.js';
import {
  detectTableFormat,
  getFormatConfig,
  type TableFormat,
  type DetectedFormat,
} from '../../migrator/table-format.js';

interface MigrationFileInfo {
  name: string;
  hash: string;
}

/**
 * Load migration files with their hashes
 */
async function loadMigrationFiles(folder: string): Promise<MigrationFileInfo[]> {
  const files = await readdir(folder);
  const migrations: MigrationFileInfo[] = [];

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;

    const filePath = join(folder, file);
    const content = await readFile(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    migrations.push({
      name: basename(file, '.sql'),
      hash,
    });
  }

  return migrations;
}

/**
 * Convert a single tenant's migration table format
 */
async function convertTenantFormat(
  pool: Pool,
  schemaName: string,
  tableName: string,
  migrations: MigrationFileInfo[],
  currentFormat: DetectedFormat,
  targetFormat: TableFormat,
  dryRun: boolean
): Promise<{ success: boolean; message: string }> {
  // Build lookup maps
  const hashToName = new Map(migrations.map((m) => [m.hash, m.name]));
  const nameToHash = new Map(migrations.map((m) => [m.name, m.hash]));

  const client = await pool.connect();

  try {
    // Read current records
    const identifierCol = currentFormat.columns.identifier;
    const current = await client.query<{ id: number; identifier: string }>(
      `SELECT id, "${identifierCol}" as identifier FROM "${schemaName}"."${tableName}" ORDER BY id`
    );

    if (dryRun) {
      const conversions: string[] = [];
      for (const row of current.rows) {
        if (targetFormat === 'name' && currentFormat.columns.identifier === 'hash') {
          const name = hashToName.get(row.identifier);
          if (name) {
            conversions.push(`  ${dim(row.identifier.slice(0, 8))}... -> ${name}`);
          } else {
            conversions.push(`  ${warning(row.identifier.slice(0, 8))}... -> ${error('unknown')}`);
          }
        } else if (targetFormat !== 'name' && currentFormat.columns.identifier === 'name') {
          const hash = nameToHash.get(row.identifier);
          if (hash) {
            conversions.push(`  ${row.identifier} -> ${dim(hash.slice(0, 16))}...`);
          } else {
            conversions.push(`  ${row.identifier} -> ${error('unknown')}`);
          }
        }
      }
      return {
        success: true,
        message: conversions.length > 0 ? conversions.join('\n') : '  No conversions needed',
      };
    }

    await client.query('BEGIN');

    try {
      if (targetFormat === 'name' && currentFormat.columns.identifier === 'hash') {
        // Converting from hash to name
        // Add name column
        await client.query(`
          ALTER TABLE "${schemaName}"."${tableName}"
          ADD COLUMN IF NOT EXISTS name VARCHAR(255)
        `);

        // Populate name from hash using migration files
        let converted = 0;
        for (const row of current.rows) {
          const name = hashToName.get(row.identifier);
          if (name) {
            await client.query(
              `UPDATE "${schemaName}"."${tableName}" SET name = $1 WHERE id = $2`,
              [name, row.id]
            );
            converted++;
          }
        }

        // Make name NOT NULL and add unique constraint
        await client.query(`
          ALTER TABLE "${schemaName}"."${tableName}"
          ALTER COLUMN name SET NOT NULL
        `);

        // Add unique constraint if it doesn't exist
        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = '${tableName}_name_unique'
            ) THEN
              ALTER TABLE "${schemaName}"."${tableName}"
              ADD CONSTRAINT ${tableName}_name_unique UNIQUE (name);
            END IF;
          END $$;
        `);

        // Rename applied_at if needed
        if (currentFormat.columns.timestamp === 'created_at') {
          await client.query(`
            ALTER TABLE "${schemaName}"."${tableName}"
            RENAME COLUMN created_at TO applied_at
          `);

          // Convert bigint to timestamp if needed
          if (currentFormat.columns.timestampType === 'bigint') {
            await client.query(`
              ALTER TABLE "${schemaName}"."${tableName}"
              ALTER COLUMN applied_at TYPE TIMESTAMP WITH TIME ZONE
              USING to_timestamp(applied_at / 1000.0)
            `);
          }
        }

        await client.query('COMMIT');
        return { success: true, message: `Converted ${converted} records to name format` };
      } else if (targetFormat !== 'name' && currentFormat.columns.identifier === 'name') {
        // Converting from name to hash/drizzle-kit
        // Add hash column
        await client.query(`
          ALTER TABLE "${schemaName}"."${tableName}"
          ADD COLUMN IF NOT EXISTS hash TEXT
        `);

        // Populate hash from name using migration files
        let converted = 0;
        for (const row of current.rows) {
          const hash = nameToHash.get(row.identifier);
          if (hash) {
            await client.query(
              `UPDATE "${schemaName}"."${tableName}" SET hash = $1 WHERE id = $2`,
              [hash, row.id]
            );
            converted++;
          }
        }

        // Make hash NOT NULL
        await client.query(`
          ALTER TABLE "${schemaName}"."${tableName}"
          ALTER COLUMN hash SET NOT NULL
        `);

        // Rename applied_at to created_at if needed
        if (currentFormat.columns.timestamp === 'applied_at') {
          await client.query(`
            ALTER TABLE "${schemaName}"."${tableName}"
            RENAME COLUMN applied_at TO created_at
          `);

          // Convert to bigint if targeting drizzle-kit
          if (targetFormat === 'drizzle-kit') {
            await client.query(`
              ALTER TABLE "${schemaName}"."${tableName}"
              ALTER COLUMN created_at TYPE BIGINT
              USING (EXTRACT(EPOCH FROM created_at) * 1000)::BIGINT
            `);
          }
        }

        await client.query('COMMIT');
        return { success: true, message: `Converted ${converted} records to ${targetFormat} format` };
      }

      await client.query('COMMIT');
      return { success: true, message: 'No conversion needed' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}

export const convertFormatCommand = new Command('convert-format')
  .description('Convert migration table format between name/hash/drizzle-kit')
  .requiredOption('--to <format>', 'Target format: name, hash, or drizzle-kit')
  .option('-c, --config <path>', 'Path to config file')
  .option('-t, --tenant <id>', 'Convert a specific tenant only')
  .option('--dry-run', 'Preview changes without applying')
  .option('--migrations-folder <path>', 'Path to migrations folder')
  .action(async (options) => {
    const spinner = createSpinner('Loading configuration...');

    try {
      // Validate target format
      const targetFormat = options.to as TableFormat;
      if (!['name', 'hash', 'drizzle-kit'].includes(targetFormat)) {
        throw new Error(`Invalid format: ${options.to}. Use: name, hash, or drizzle-kit`);
      }

      spinner.start();

      const { config, migrationsFolder, migrationsTable, tenantDiscovery } = await loadConfig(options.config);

      const tableName = migrationsTable ?? '__drizzle_migrations';

      const folder = options.migrationsFolder
        ? resolveMigrationsFolder(options.migrationsFolder)
        : resolveMigrationsFolder(migrationsFolder);

      spinner.text = 'Loading migration files...';
      const migrations = await loadMigrationFiles(folder);

      spinner.text = 'Discovering tenants...';

      let tenantIds: string[];
      if (options.tenant) {
        tenantIds = [options.tenant];
      } else {
        if (!tenantDiscovery) {
          throw new Error(
            'No tenant discovery function configured. Add migrations.tenantDiscovery to your config.'
          );
        }
        tenantIds = await tenantDiscovery();
      }

      spinner.succeed(`Found ${tenantIds.length} tenant${tenantIds.length > 1 ? 's' : ''}`);

      if (options.dryRun) {
        console.log(warning(bold('\nDry run mode - no changes will be made\n')));
      }

      console.log(bold(`\nConverting to ${targetFormat} format:\n`));

      let successCount = 0;
      let skipCount = 0;
      let failCount = 0;

      for (const tenantId of tenantIds) {
        const schemaName = config.isolation.schemaNameTemplate(tenantId);

        const pool = new Pool({
          connectionString: config.connection.url,
          ...config.connection.poolConfig,
        });

        try {
          // Detect current format
          const currentFormat = await detectTableFormat(pool, schemaName, tableName);

          if (!currentFormat) {
            console.log(`${dim(tenantId)}: ${dim('No migrations table found, skipping')}`);
            skipCount++;
            continue;
          }

          if (currentFormat.format === targetFormat) {
            console.log(`${dim(tenantId)}: ${dim(`Already using ${targetFormat} format`)}`);
            skipCount++;
            continue;
          }

          console.log(`${bold(tenantId)}: ${currentFormat.format} -> ${targetFormat}`);

          const result = await convertTenantFormat(
            pool,
            schemaName,
            tableName,
            migrations,
            currentFormat,
            targetFormat,
            options.dryRun
          );

          if (result.success) {
            if (options.dryRun) {
              console.log(result.message);
            } else {
              console.log(`  ${success(result.message)}`);
            }
            successCount++;
          } else {
            console.log(`  ${error(result.message)}`);
            failCount++;
          }
        } catch (err) {
          console.log(`  ${error((err as Error).message)}`);
          failCount++;
        } finally {
          await pool.end();
        }
      }

      console.log(bold('\nSummary:'));
      console.log(`  Converted: ${success(successCount.toString())}`);
      console.log(`  Skipped:   ${dim(skipCount.toString())}`);
      if (failCount > 0) {
        console.log(`  Failed:    ${error(failCount.toString())}`);
        process.exit(1);
      }
    } catch (err) {
      spinner.fail((err as Error).message);
      process.exit(1);
    }
  });
