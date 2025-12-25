import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';

import {
  scaffoldSchema,
  scaffoldSeed,
  scaffoldMigration,
  toCase,
  getMigrationTemplates,
  DEFAULT_DIRS,
} from './generator.js';

describe('scaffold/generator', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `scaffold-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('toCase', () => {
    it('should convert snake_case to all formats', () => {
      const result = toCase('user_profiles');
      expect(result.snake).toBe('user_profiles');
      expect(result.pascal).toBe('UserProfiles');
      expect(result.camel).toBe('userProfiles');
    });

    it('should convert camelCase to all formats', () => {
      const result = toCase('userProfiles');
      expect(result.snake).toBe('user_profiles');
      expect(result.pascal).toBe('UserProfiles');
      expect(result.camel).toBe('userProfiles');
    });

    it('should convert kebab-case to all formats', () => {
      const result = toCase('user-profiles');
      expect(result.snake).toBe('user_profiles');
      expect(result.pascal).toBe('UserProfiles');
      expect(result.camel).toBe('userProfiles');
    });

    it('should convert PascalCase to all formats', () => {
      const result = toCase('UserProfiles');
      expect(result.snake).toBe('user_profiles');
      expect(result.pascal).toBe('UserProfiles');
      expect(result.camel).toBe('userProfiles');
    });

    it('should handle single word', () => {
      const result = toCase('orders');
      expect(result.snake).toBe('orders');
      expect(result.pascal).toBe('Orders');
      expect(result.camel).toBe('orders');
    });
  });

  describe('DEFAULT_DIRS', () => {
    it('should have correct default directories', () => {
      expect(DEFAULT_DIRS.schemaDir).toBe('src/db/schema');
      expect(DEFAULT_DIRS.seedDir).toBe('drizzle/seeds');
      expect(DEFAULT_DIRS.tenantMigrationsDir).toBe('drizzle/tenant-migrations');
      expect(DEFAULT_DIRS.sharedMigrationsDir).toBe('drizzle/shared-migrations');
    });
  });

  describe('getMigrationTemplates', () => {
    it('should return all available templates', () => {
      const templates = getMigrationTemplates();
      expect(templates).toHaveLength(5);
      expect(templates.map((t) => t.value)).toEqual([
        'create-table',
        'add-column',
        'add-index',
        'add-foreign-key',
        'blank',
      ]);
    });

    it('should have descriptions for all templates', () => {
      const templates = getMigrationTemplates();
      templates.forEach((t) => {
        expect(t.label).toBeDefined();
        expect(t.description).toBeDefined();
      });
    });
  });

  describe('scaffoldSchema', () => {
    it('should create a tenant schema file', async () => {
      const result = await scaffoldSchema({
        name: 'orders',
        type: 'tenant',
        outputDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.kind).toBe('schema');
      expect(result.type).toBe('tenant');
      expect(result.fileName).toBe('orders.ts');
      expect(existsSync(result.filePath)).toBe(true);

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain("export const orders = pgTable('orders'");
      expect(content).toContain('Type: tenant');
      expect(content).toContain('createdAt');
      expect(content).toContain('updatedAt');
    });

    it('should create a shared schema file', async () => {
      const result = await scaffoldSchema({
        name: 'plans',
        type: 'shared',
        outputDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.type).toBe('shared');
      expect(result.fileName).toBe('plans.ts');

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('Type: shared');
    });

    it('should use UUID by default', async () => {
      const result = await scaffoldSchema({
        name: 'products',
        type: 'tenant',
        outputDir: testDir,
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain("uuid('id')");
      expect(content).toContain('.defaultRandom()');
    });

    it('should use serial when useUuid is false', async () => {
      const result = await scaffoldSchema({
        name: 'products',
        type: 'tenant',
        outputDir: testDir,
        useUuid: false,
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain("serial('id')");
    });

    it('should exclude timestamps when includeTimestamps is false', async () => {
      const result = await scaffoldSchema({
        name: 'products',
        type: 'tenant',
        outputDir: testDir,
        includeTimestamps: false,
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).not.toContain('createdAt');
      expect(content).not.toContain('updatedAt');
    });

    it('should include soft delete when includeSoftDelete is true', async () => {
      const result = await scaffoldSchema({
        name: 'products',
        type: 'tenant',
        outputDir: testDir,
        includeSoftDelete: true,
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('deletedAt');
    });

    it('should exclude example columns when includeExample is false', async () => {
      const result = await scaffoldSchema({
        name: 'products',
        type: 'tenant',
        outputDir: testDir,
        includeExample: false,
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).not.toContain("name: varchar('name'");
      expect(content).not.toContain("description: text('description')");
      expect(content).not.toContain("isActive: boolean('is_active')");
    });

    it('should fail if file already exists', async () => {
      // Create the file first
      await scaffoldSchema({
        name: 'orders',
        type: 'tenant',
        outputDir: testDir,
      });

      // Try to create again
      const result = await scaffoldSchema({
        name: 'orders',
        type: 'tenant',
        outputDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should generate Zod schemas and types', async () => {
      const result = await scaffoldSchema({
        name: 'orders',
        type: 'tenant',
        outputDir: testDir,
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('createInsertSchema');
      expect(content).toContain('createSelectSchema');
      expect(content).toContain('insertOrdersSchema');
      expect(content).toContain('selectOrdersSchema');
      expect(content).toContain('type Orders =');
      expect(content).toContain('type NewOrders =');
    });

    it('should handle complex names with hyphens', async () => {
      const result = await scaffoldSchema({
        name: 'user-order-items',
        type: 'tenant',
        outputDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.fileName).toBe('userOrderItems.ts');

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain("pgTable('user_order_items'");
      expect(content).toContain('export const userOrderItems');
    });
  });

  describe('scaffoldSeed', () => {
    it('should create a tenant seed file', async () => {
      const result = await scaffoldSeed({
        name: 'initial',
        type: 'tenant',
        outputDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.kind).toBe('seed');
      expect(result.type).toBe('tenant');
      expect(result.fileName).toBe('initial.ts');
      expect(existsSync(result.filePath)).toBe(true);

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('SeedFunction');
      expect(content).toContain('Tenant seed: initial');
      expect(content).toContain('export const seed');
    });

    it('should create a shared seed file', async () => {
      const result = await scaffoldSeed({
        name: 'plans',
        type: 'shared',
        outputDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.type).toBe('shared');

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('SharedSeedFunction');
      expect(content).toContain('Shared seed: plans');
    });

    it('should include table import when tableName is provided', async () => {
      const result = await scaffoldSeed({
        name: 'orders',
        type: 'tenant',
        outputDir: testDir,
        tableName: 'orders',
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain("import { orders } from");
    });

    it('should fail if file already exists', async () => {
      await scaffoldSeed({
        name: 'initial',
        type: 'tenant',
        outputDir: testDir,
      });

      const result = await scaffoldSeed({
        name: 'initial',
        type: 'tenant',
        outputDir: testDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('scaffoldMigration', () => {
    it('should create a tenant migration file with sequence', async () => {
      const result = await scaffoldMigration({
        name: 'add-orders',
        type: 'tenant',
        outputDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.kind).toBe('migration');
      expect(result.type).toBe('tenant');
      expect(result.fileName).toBe('0001_add_orders.sql');
      expect(existsSync(result.filePath)).toBe(true);

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('Migration: add-orders');
      expect(content).toContain('Type: tenant');
    });

    it('should create a shared migration file', async () => {
      const result = await scaffoldMigration({
        name: 'create-plans',
        type: 'shared',
        outputDir: testDir,
      });

      expect(result.success).toBe(true);
      expect(result.type).toBe('shared');

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('Type: shared');
    });

    it('should increment sequence number', async () => {
      await scaffoldMigration({
        name: 'first',
        type: 'tenant',
        outputDir: testDir,
      });

      const result = await scaffoldMigration({
        name: 'second',
        type: 'tenant',
        outputDir: testDir,
      });

      expect(result.fileName).toBe('0002_second.sql');
    });

    it('should use create-table template', async () => {
      const result = await scaffoldMigration({
        name: 'create-orders',
        type: 'tenant',
        outputDir: testDir,
        template: 'create-table',
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('CREATE TABLE IF NOT EXISTS');
      expect(content).toContain('PRIMARY KEY');
      expect(content).toContain('CREATE INDEX');
    });

    it('should use add-column template', async () => {
      const result = await scaffoldMigration({
        name: 'add-status-column',
        type: 'tenant',
        outputDir: testDir,
        template: 'add-column',
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('ALTER TABLE');
      expect(content).toContain('ADD COLUMN');
    });

    it('should use add-index template', async () => {
      const result = await scaffoldMigration({
        name: 'add-orders-index',
        type: 'tenant',
        outputDir: testDir,
        template: 'add-index',
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('CREATE INDEX');
      expect(content).toContain('CONCURRENTLY');
    });

    it('should use add-foreign-key template', async () => {
      const result = await scaffoldMigration({
        name: 'add-fk-orders-users',
        type: 'tenant',
        outputDir: testDir,
        template: 'add-foreign-key',
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('FOREIGN KEY');
      expect(content).toContain('REFERENCES');
    });

    it('should use blank template', async () => {
      const result = await scaffoldMigration({
        name: 'custom-migration',
        type: 'tenant',
        outputDir: testDir,
        template: 'blank',
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('Write your SQL migration here');
    });

    it('should infer template from name', async () => {
      const result = await scaffoldMigration({
        name: 'create-users-table',
        type: 'tenant',
        outputDir: testDir,
      });

      const content = await readFile(result.filePath, 'utf-8');
      expect(content).toContain('Template: create-table');
    });

    it('should sanitize migration name for filename', async () => {
      const result = await scaffoldMigration({
        name: 'Add Users & Orders!!',
        type: 'tenant',
        outputDir: testDir,
      });

      expect(result.fileName).toBe('0001_add_users_orders.sql');
    });
  });
});
