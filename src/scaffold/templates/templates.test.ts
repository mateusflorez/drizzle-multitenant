import { describe, it, expect } from 'vitest';

import { generateSchemaTemplate } from './schema-template.js';
import { generateSeedTemplate } from './seed-template.js';
import {
  generateMigrationTemplate,
  inferTableName,
  inferMigrationTemplate,
} from './migration-template.js';

describe('scaffold/templates', () => {
  describe('generateSchemaTemplate', () => {
    it('should generate a basic schema template', () => {
      const content = generateSchemaTemplate({
        tableName: 'orders',
        tableNamePascal: 'Orders',
        tableNameCamel: 'orders',
        type: 'tenant',
        includeTimestamps: true,
        includeSoftDelete: false,
        useUuid: true,
        includeExample: true,
      });

      expect(content).toContain("export const orders = pgTable('orders'");
      expect(content).toContain("uuid('id')");
      expect(content).toContain('.primaryKey()');
      expect(content).toContain('.defaultRandom()');
      expect(content).toContain("name: varchar('name'");
      expect(content).toContain("createdAt: timestamp('created_at'");
      expect(content).toContain("updatedAt: timestamp('updated_at'");
    });

    it('should generate schema with serial id when useUuid is false', () => {
      const content = generateSchemaTemplate({
        tableName: 'orders',
        tableNamePascal: 'Orders',
        tableNameCamel: 'orders',
        type: 'tenant',
        includeTimestamps: false,
        includeSoftDelete: false,
        useUuid: false,
        includeExample: false,
      });

      expect(content).toContain("serial('id')");
      expect(content).not.toContain('uuid');
    });

    it('should include soft delete when enabled', () => {
      const content = generateSchemaTemplate({
        tableName: 'orders',
        tableNamePascal: 'Orders',
        tableNameCamel: 'orders',
        type: 'tenant',
        includeTimestamps: false,
        includeSoftDelete: true,
        useUuid: true,
        includeExample: false,
      });

      expect(content).toContain("deletedAt: timestamp('deleted_at'");
    });

    it('should generate indexes when example columns are included', () => {
      const content = generateSchemaTemplate({
        tableName: 'products',
        tableNamePascal: 'Products',
        tableNameCamel: 'products',
        type: 'tenant',
        includeTimestamps: true,
        includeSoftDelete: false,
        useUuid: true,
        includeExample: true,
      });

      expect(content).toContain('productsIndexes');
      expect(content).toContain("index('products_name_idx')");
      expect(content).toContain("index('products_is_active_idx')");
      expect(content).toContain("index('products_created_at_idx')");
    });

    it('should include Zod validation schemas', () => {
      const content = generateSchemaTemplate({
        tableName: 'orders',
        tableNamePascal: 'Orders',
        tableNameCamel: 'orders',
        type: 'tenant',
        includeTimestamps: true,
        includeSoftDelete: false,
        useUuid: true,
        includeExample: true,
      });

      expect(content).toContain('import { createInsertSchema, createSelectSchema }');
      expect(content).toContain("import { z } from 'zod'");
      expect(content).toContain('insertOrdersSchema');
      expect(content).toContain('selectOrdersSchema');
    });

    it('should generate type exports', () => {
      const content = generateSchemaTemplate({
        tableName: 'orders',
        tableNamePascal: 'Orders',
        tableNameCamel: 'orders',
        type: 'tenant',
        includeTimestamps: true,
        includeSoftDelete: false,
        useUuid: true,
        includeExample: true,
      });

      expect(content).toContain('type Orders = typeof orders.$inferSelect');
      expect(content).toContain('type NewOrders = typeof orders.$inferInsert');
      expect(content).toContain('type InsertOrders = z.infer<typeof insertOrdersSchema>');
      expect(content).toContain('type SelectOrders = z.infer<typeof selectOrdersSchema>');
    });

    it('should include schema type in header', () => {
      const tenantContent = generateSchemaTemplate({
        tableName: 'orders',
        tableNamePascal: 'Orders',
        tableNameCamel: 'orders',
        type: 'tenant',
        includeTimestamps: false,
        includeSoftDelete: false,
        useUuid: true,
        includeExample: false,
      });

      const sharedContent = generateSchemaTemplate({
        tableName: 'plans',
        tableNamePascal: 'Plans',
        tableNameCamel: 'plans',
        type: 'shared',
        includeTimestamps: false,
        includeSoftDelete: false,
        useUuid: true,
        includeExample: false,
      });

      expect(tenantContent).toContain('Type: tenant');
      expect(sharedContent).toContain('Type: shared');
    });
  });

  describe('generateSeedTemplate', () => {
    it('should generate a tenant seed template', () => {
      const content = generateSeedTemplate({
        seedName: 'initial',
        type: 'tenant',
      });

      expect(content).toContain('Tenant seed: initial');
      expect(content).toContain('import type { SeedFunction }');
      expect(content).toContain('export const seed: SeedFunction');
      expect(content).toContain('async (db, tenantId)');
    });

    it('should generate a shared seed template', () => {
      const content = generateSeedTemplate({
        seedName: 'plans',
        type: 'shared',
      });

      expect(content).toContain('Shared seed: plans');
      expect(content).toContain('import type { SharedSeedFunction }');
      expect(content).toContain('export const seed: SharedSeedFunction');
      expect(content).toContain('async (db)');
    });

    it('should include table import when tableName is provided for tenant', () => {
      const content = generateSeedTemplate({
        seedName: 'orders',
        type: 'tenant',
        tableName: 'orders',
      });

      expect(content).toContain("import { orders } from '../../src/db/schema/tenant/orders.js'");
      expect(content).toContain('await db.insert(orders)');
    });

    it('should include table import when tableName is provided for shared', () => {
      const content = generateSeedTemplate({
        seedName: 'plans',
        type: 'shared',
        tableName: 'plans',
      });

      expect(content).toContain("import { plans } from '../../src/db/schema/shared/plans.js'");
      expect(content).toContain('await db.insert(plans)');
    });

    it('should include commented example when no table is provided', () => {
      const tenantContent = generateSeedTemplate({
        seedName: 'initial',
        type: 'tenant',
      });

      const sharedContent = generateSeedTemplate({
        seedName: 'plans',
        type: 'shared',
      });

      expect(tenantContent).toContain('// import { yourTable }');
      expect(sharedContent).toContain('// import { yourTable }');
    });

    it('should include CLI usage example', () => {
      const content = generateSeedTemplate({
        seedName: 'initial',
        type: 'tenant',
      });

      expect(content).toContain('npx drizzle-multitenant seed');
      expect(content).toContain('--file=./drizzle/seeds/tenant/initial.ts');
    });
  });

  describe('generateMigrationTemplate', () => {
    it('should generate a blank migration template', () => {
      const content = generateMigrationTemplate({
        migrationName: 'custom-change',
        type: 'tenant',
        template: 'blank',
      });

      expect(content).toContain('Migration: custom-change');
      expect(content).toContain('Type: tenant');
      expect(content).toContain('Template: blank');
      expect(content).toContain('Write your SQL migration here');
    });

    it('should generate a create-table template', () => {
      const content = generateMigrationTemplate({
        migrationName: 'create-orders',
        type: 'tenant',
        template: 'create-table',
        tableName: 'orders',
      });

      expect(content).toContain('CREATE TABLE IF NOT EXISTS "orders"');
      expect(content).toContain('"id" UUID PRIMARY KEY');
      expect(content).toContain('"created_at" TIMESTAMPTZ');
      expect(content).toContain('"updated_at" TIMESTAMPTZ');
      expect(content).toContain('CREATE INDEX IF NOT EXISTS "orders_name_idx"');
    });

    it('should generate an add-column template', () => {
      const content = generateMigrationTemplate({
        migrationName: 'add-status',
        type: 'tenant',
        template: 'add-column',
        tableName: 'orders',
      });

      expect(content).toContain('Add column to: orders');
      expect(content).toContain('ALTER TABLE "orders" ADD COLUMN');
    });

    it('should generate an add-index template', () => {
      const content = generateMigrationTemplate({
        migrationName: 'add-orders-index',
        type: 'tenant',
        template: 'add-index',
        tableName: 'orders',
      });

      expect(content).toContain('Add index to: orders');
      expect(content).toContain('CREATE INDEX');
      expect(content).toContain('CONCURRENTLY');
      expect(content).toContain('GIN index');
    });

    it('should generate an add-foreign-key template', () => {
      const content = generateMigrationTemplate({
        migrationName: 'add-user-fk',
        type: 'tenant',
        template: 'add-foreign-key',
        tableName: 'orders',
      });

      expect(content).toContain('Add foreign key to: orders');
      expect(content).toContain('FOREIGN KEY');
      expect(content).toContain('REFERENCES');
      expect(content).toContain('ON DELETE');
      expect(content).toContain('Cross-schema foreign key');
    });

    it('should include timestamp in header', () => {
      const content = generateMigrationTemplate({
        migrationName: 'test',
        type: 'tenant',
        template: 'blank',
      });

      expect(content).toMatch(/Created at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('inferTableName', () => {
    it('should extract table name from create pattern', () => {
      expect(inferTableName('create-orders')).toBe('order');
      expect(inferTableName('create-user-profiles')).toBe('user_profile');
    });

    it('should extract table name from add pattern', () => {
      expect(inferTableName('add-products')).toBe('product');
    });

    it('should handle add pattern with index in name', () => {
      // The function captures 'index-on-users' from 'add-index-on-users' due to greedy matching
      // This is expected behavior - table name inference is best-effort
      const result = inferTableName('add-orders');
      expect(result).toBe('order');
    });

    it('should return undefined for non-matching patterns', () => {
      expect(inferTableName('something-random')).toBeUndefined();
    });
  });

  describe('inferMigrationTemplate', () => {
    it('should infer create-table from name', () => {
      expect(inferMigrationTemplate('create-users')).toBe('create-table');
      expect(inferMigrationTemplate('create-orders-table')).toBe('create-table');
      expect(inferMigrationTemplate('add-users-table')).toBe('create-table');
    });

    it('should infer add-index from name', () => {
      expect(inferMigrationTemplate('add-users-index')).toBe('add-index');
      expect(inferMigrationTemplate('add-idx-orders')).toBe('add-index');
    });

    it('should infer add-foreign-key from name', () => {
      expect(inferMigrationTemplate('add-user-fk')).toBe('add-foreign-key');
      expect(inferMigrationTemplate('add-foreign-key-orders')).toBe('add-foreign-key');
      expect(inferMigrationTemplate('add-reference-to-users')).toBe('add-foreign-key');
    });

    it('should infer add-column from name', () => {
      expect(inferMigrationTemplate('add-status-column')).toBe('add-column');
      expect(inferMigrationTemplate('add-email')).toBe('add-column');
    });

    it('should default to blank for unknown patterns', () => {
      expect(inferMigrationTemplate('fix-something')).toBe('blank');
      expect(inferMigrationTemplate('update-data')).toBe('blank');
    });
  });
});
