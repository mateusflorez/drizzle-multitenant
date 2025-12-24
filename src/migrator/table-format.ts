import type { Pool } from 'pg';

/**
 * Table format for tracking migrations
 * - "name": drizzle-multitenant native (filename-based)
 * - "hash": SHA-256 hash with timestamp
 * - "drizzle-kit": Exact drizzle-kit format (hash + bigint timestamp)
 */
export type TableFormat = 'name' | 'hash' | 'drizzle-kit';

/**
 * Detected table format information
 */
export interface DetectedFormat {
  /** The detected format type */
  format: TableFormat;
  /** The table name */
  tableName: string;
  /** Column configuration */
  columns: {
    /** Column used for identifying migrations */
    identifier: 'name' | 'hash';
    /** Column used for timestamp */
    timestamp: 'applied_at' | 'created_at';
    /** Data type of timestamp column */
    timestampType: 'timestamp' | 'bigint';
  };
}

/**
 * Default format configuration for new tables
 */
export const DEFAULT_FORMAT: DetectedFormat = {
  format: 'name',
  tableName: '__drizzle_migrations',
  columns: {
    identifier: 'name',
    timestamp: 'applied_at',
    timestampType: 'timestamp',
  },
};

/**
 * drizzle-kit format configuration
 */
export const DRIZZLE_KIT_FORMAT: DetectedFormat = {
  format: 'drizzle-kit',
  tableName: '__drizzle_migrations',
  columns: {
    identifier: 'hash',
    timestamp: 'created_at',
    timestampType: 'bigint',
  },
};

interface ColumnInfo {
  column_name: string;
  data_type: string;
}

/**
 * Detect the format of an existing migrations table
 *
 * @param pool - Database connection pool
 * @param schemaName - Schema to check
 * @param tableName - Migrations table name
 * @returns Detected format or null if table doesn't exist
 */
export async function detectTableFormat(
  pool: Pool,
  schemaName: string,
  tableName: string
): Promise<DetectedFormat | null> {
  // Check if table exists
  const tableExists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = $2
    ) as exists`,
    [schemaName, tableName]
  );

  if (!tableExists.rows[0]?.exists) {
    return null;
  }

  // Get column information
  const columnsResult = await pool.query<ColumnInfo>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [schemaName, tableName]
  );

  const columnMap = new Map<string, string>(
    columnsResult.rows.map((r) => [r.column_name, r.data_type])
  );

  // Detect format based on columns
  if (columnMap.has('name')) {
    // drizzle-multitenant native format
    return {
      format: 'name',
      tableName,
      columns: {
        identifier: 'name',
        timestamp: columnMap.has('applied_at') ? 'applied_at' : 'created_at',
        timestampType: 'timestamp',
      },
    };
  }

  if (columnMap.has('hash')) {
    const createdAtType = columnMap.get('created_at');

    // drizzle-kit uses bigint for created_at
    if (createdAtType === 'bigint') {
      return {
        format: 'drizzle-kit',
        tableName,
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'bigint',
        },
      };
    }

    // Custom hash-based format with regular timestamp
    return {
      format: 'hash',
      tableName,
      columns: {
        identifier: 'hash',
        timestamp: 'created_at',
        timestampType: 'timestamp',
      },
    };
  }

  // Unknown format - return null to trigger error handling
  return null;
}

/**
 * Get the format configuration for a specific format type
 */
export function getFormatConfig(
  format: TableFormat,
  tableName: string = '__drizzle_migrations'
): DetectedFormat {
  switch (format) {
    case 'name':
      return {
        format: 'name',
        tableName,
        columns: {
          identifier: 'name',
          timestamp: 'applied_at',
          timestampType: 'timestamp',
        },
      };
    case 'hash':
      return {
        format: 'hash',
        tableName,
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'timestamp',
        },
      };
    case 'drizzle-kit':
      return {
        format: 'drizzle-kit',
        tableName,
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'bigint',
        },
      };
  }
}
