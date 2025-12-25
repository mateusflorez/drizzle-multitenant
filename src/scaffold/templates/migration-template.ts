/**
 * Migration template generator
 *
 * @module scaffold/templates/migration-template
 */

import type { MigrationTemplate, MigrationTemplateContext } from '../types.js';

/**
 * Generate a SQL migration file content
 *
 * @param context - Template context
 * @returns Generated SQL migration content
 *
 * @example
 * ```typescript
 * const content = generateMigrationTemplate({
 *   migrationName: 'add-orders',
 *   type: 'tenant',
 *   template: 'create-table',
 *   tableName: 'orders',
 * });
 * ```
 */
export function generateMigrationTemplate(context: MigrationTemplateContext): string {
  const { migrationName, type, template, tableName } = context;
  const timestamp = new Date().toISOString();

  const header = `-- Migration: ${migrationName}
-- Type: ${type}
-- Created at: ${timestamp}
-- Template: ${template}

`;

  switch (template) {
    case 'create-table':
      return header + generateCreateTableTemplate(tableName);
    case 'add-column':
      return header + generateAddColumnTemplate(tableName);
    case 'add-index':
      return header + generateAddIndexTemplate(tableName);
    case 'add-foreign-key':
      return header + generateAddForeignKeyTemplate(tableName);
    case 'blank':
    default:
      return header + generateBlankTemplate();
  }
}

function generateCreateTableTemplate(tableName?: string): string {
  const table = tableName || 'table_name';

  return `-- Create table: ${table}
CREATE TABLE IF NOT EXISTS "${table}" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "${table}_name_idx" ON "${table}" ("name");
CREATE INDEX IF NOT EXISTS "${table}_created_at_idx" ON "${table}" ("created_at");

-- Add updated_at trigger (optional but recommended)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_${table}_updated_at ON "${table}";
CREATE TRIGGER update_${table}_updated_at
  BEFORE UPDATE ON "${table}"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
`;
}

function generateAddColumnTemplate(tableName?: string): string {
  const table = tableName || 'table_name';

  return `-- Add column to: ${table}
-- ALTER TABLE "${table}" ADD COLUMN "column_name" data_type [constraints];

-- Examples:

-- Add a nullable text column
-- ALTER TABLE "${table}" ADD COLUMN "notes" TEXT;

-- Add a non-null column with default
-- ALTER TABLE "${table}" ADD COLUMN "status" VARCHAR(50) NOT NULL DEFAULT 'pending';

-- Add a column with foreign key reference
-- ALTER TABLE "${table}" ADD COLUMN "user_id" UUID REFERENCES "users" ("id");

-- Add a column with check constraint
-- ALTER TABLE "${table}" ADD COLUMN "priority" INTEGER CHECK (priority >= 1 AND priority <= 5);

-- Write your column additions below:

`;
}

function generateAddIndexTemplate(tableName?: string): string {
  const table = tableName || 'table_name';

  return `-- Add index to: ${table}
-- CREATE INDEX [CONCURRENTLY] "index_name" ON "${table}" ("column_name");

-- Examples:

-- Simple index on single column
-- CREATE INDEX "${table}_column_idx" ON "${table}" ("column_name");

-- Composite index on multiple columns
-- CREATE INDEX "${table}_col1_col2_idx" ON "${table}" ("column1", "column2");

-- Partial index (filtered)
-- CREATE INDEX "${table}_active_idx" ON "${table}" ("created_at") WHERE "is_active" = true;

-- Unique index
-- CREATE UNIQUE INDEX "${table}_email_unique_idx" ON "${table}" ("email");

-- GIN index for full-text search or JSONB
-- CREATE INDEX "${table}_data_gin_idx" ON "${table}" USING GIN ("data");

-- CONCURRENT index (doesn't lock table, recommended for production)
-- CREATE INDEX CONCURRENTLY "${table}_column_idx" ON "${table}" ("column_name");

-- Write your indexes below:

`;
}

function generateAddForeignKeyTemplate(tableName?: string): string {
  const table = tableName || 'table_name';

  return `-- Add foreign key to: ${table}
-- ALTER TABLE "${table}" ADD CONSTRAINT "fk_name" FOREIGN KEY ("column") REFERENCES "other_table" ("id");

-- Examples:

-- Basic foreign key
-- ALTER TABLE "${table}" ADD CONSTRAINT "${table}_user_id_fk"
--   FOREIGN KEY ("user_id") REFERENCES "users" ("id");

-- Foreign key with ON DELETE action
-- ALTER TABLE "${table}" ADD CONSTRAINT "${table}_user_id_fk"
--   FOREIGN KEY ("user_id") REFERENCES "users" ("id")
--   ON DELETE CASCADE;

-- Foreign key with ON UPDATE action
-- ALTER TABLE "${table}" ADD CONSTRAINT "${table}_category_id_fk"
--   FOREIGN KEY ("category_id") REFERENCES "categories" ("id")
--   ON DELETE SET NULL
--   ON UPDATE CASCADE;

-- Cross-schema foreign key (to shared/public schema)
-- ALTER TABLE "${table}" ADD CONSTRAINT "${table}_plan_id_fk"
--   FOREIGN KEY ("plan_id") REFERENCES "public"."plans" ("id");

-- Write your foreign keys below:

`;
}

function generateBlankTemplate(): string {
  return `-- Write your SQL migration here

-- Up migration (apply changes)


-- Remember to consider:
-- 1. Idempotency: Use IF NOT EXISTS / IF EXISTS where possible
-- 2. Transactions: This will run in a transaction
-- 3. Rollback: Plan how to undo these changes if needed
`;
}

/**
 * Infer table name from migration name
 *
 * @param migrationName - Name of the migration
 * @returns Inferred table name or undefined
 *
 * @example
 * ```typescript
 * inferTableName('add-orders') // 'orders'
 * inferTableName('create-user-profiles') // 'user_profiles'
 * inferTableName('add-index-to-users') // 'users'
 * ```
 */
export function inferTableName(migrationName: string): string | undefined {
  // Common patterns to extract table name
  const patterns = [
    /^create[-_](.+)$/i,
    /^add[-_](.+?)[-_]?(?:table)?$/i,
    /^(?:add|create)[-_](?:index|fk|constraint)[-_](?:to|on)[-_](.+)$/i,
    /^(.+?)[-_](?:table|schema)$/i,
  ];

  for (const pattern of patterns) {
    const match = migrationName.match(pattern);
    if (match?.[1]) {
      // Convert to snake_case
      return match[1]
        .toLowerCase()
        .replace(/[-\s]+/g, '_')
        .replace(/s$/, ''); // Remove trailing 's' for plural
    }
  }

  return undefined;
}

/**
 * Determine the best template based on migration name
 *
 * @param migrationName - Name of the migration
 * @returns Suggested template type
 */
export function inferMigrationTemplate(migrationName: string): MigrationTemplate {
  const name = migrationName.toLowerCase();

  if (name.includes('create') || name.includes('table')) {
    return 'create-table';
  }

  if (name.includes('index') || name.includes('idx')) {
    return 'add-index';
  }

  if (name.includes('fk') || name.includes('foreign') || name.includes('reference')) {
    return 'add-foreign-key';
  }

  if (name.includes('add') || name.includes('column')) {
    return 'add-column';
  }

  return 'blank';
}
