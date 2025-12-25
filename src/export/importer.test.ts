import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SchemaImporter, createSchemaImporter, loadSchemaExport } from './importer.js';
import type { SchemaExport, ImportOptions } from './types.js';

const mockSchemaExport: SchemaExport = {
  version: '1.0.0',
  exportedAt: new Date().toISOString(),
  projectName: 'test-project',
  tables: [
    {
      name: 'users',
      schemaType: 'tenant',
      columns: [
        {
          name: 'id',
          dataType: 'uuid',
          isPrimaryKey: true,
          isNullable: false,
          hasDefault: true,
        },
        {
          name: 'email',
          dataType: 'varchar(255)',
          isPrimaryKey: false,
          isNullable: false,
          hasDefault: false,
        },
        {
          name: 'name',
          dataType: 'text',
          isPrimaryKey: false,
          isNullable: true,
          hasDefault: false,
        },
        {
          name: 'is_active',
          dataType: 'boolean',
          isPrimaryKey: false,
          isNullable: false,
          hasDefault: true,
          defaultValue: 'true',
        },
        {
          name: 'created_at',
          dataType: 'timestamp with time zone',
          isPrimaryKey: false,
          isNullable: false,
          hasDefault: true,
          defaultValue: 'now()',
        },
      ],
      indexes: [
        {
          name: 'users_email_idx',
          columns: ['email'],
          isUnique: true,
        },
      ],
    },
    {
      name: 'orders',
      schemaType: 'tenant',
      columns: [
        {
          name: 'id',
          dataType: 'uuid',
          isPrimaryKey: true,
          isNullable: false,
          hasDefault: true,
        },
        {
          name: 'user_id',
          dataType: 'uuid',
          isPrimaryKey: false,
          isNullable: false,
          hasDefault: false,
          references: {
            table: 'users',
            column: 'id',
            onDelete: 'CASCADE',
          },
        },
        {
          name: 'total',
          dataType: 'numeric(10,2)',
          isPrimaryKey: false,
          isNullable: false,
          hasDefault: false,
        },
      ],
      indexes: [
        {
          name: 'orders_user_id_idx',
          columns: ['user_id'],
          isUnique: false,
        },
      ],
    },
    {
      name: 'plans',
      schemaType: 'shared',
      columns: [
        {
          name: 'id',
          dataType: 'uuid',
          isPrimaryKey: true,
          isNullable: false,
          hasDefault: true,
        },
        {
          name: 'name',
          dataType: 'varchar(100)',
          isPrimaryKey: false,
          isNullable: false,
          hasDefault: false,
        },
        {
          name: 'price',
          dataType: 'integer',
          isPrimaryKey: false,
          isNullable: false,
          hasDefault: true,
          defaultValue: '0',
        },
        {
          name: 'features',
          dataType: 'jsonb',
          isPrimaryKey: false,
          isNullable: true,
          hasDefault: false,
        },
      ],
      indexes: [],
    },
  ],
};

describe('SchemaImporter', () => {
  let importer: SchemaImporter;
  let testDir: string;

  beforeEach(async () => {
    importer = createSchemaImporter();
    testDir = join(tmpdir(), `drizzle-import-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('import', () => {
    it('should create tenant and shared directories', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
        dryRun: false,
      };

      const result = await importer.import(mockSchemaExport, options);

      expect(result.success).toBe(true);
      expect(result.filesCreated.length).toBeGreaterThan(0);
    });

    it('should create schema files for all tables', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
      };

      const result = await importer.import(mockSchemaExport, options);

      // Should create users.ts, orders.ts, index.ts for tenant
      // Should create plans.ts, index.ts for shared
      expect(result.filesCreated).toContainEqual(expect.stringContaining('users.ts'));
      expect(result.filesCreated).toContainEqual(expect.stringContaining('orders.ts'));
      expect(result.filesCreated).toContainEqual(expect.stringContaining('plans.ts'));
      expect(result.filesCreated.filter((f) => f.includes('index.ts'))).toHaveLength(2);
    });

    it('should generate correct Drizzle imports', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
      };

      await importer.import(mockSchemaExport, options);

      const usersContent = await readFile(join(testDir, 'tenant', 'users.ts'), 'utf-8');

      expect(usersContent).toContain("from 'drizzle-orm/pg-core'");
      expect(usersContent).toContain('pgTable');
      expect(usersContent).toContain('uuid');
      expect(usersContent).toContain('varchar');
      expect(usersContent).toContain('text');
      expect(usersContent).toContain('boolean');
      expect(usersContent).toContain('timestamp');
      expect(usersContent).toContain('index');
      expect(usersContent).toContain('uniqueIndex');
    });

    it('should generate correct column definitions', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
      };

      await importer.import(mockSchemaExport, options);

      const usersContent = await readFile(join(testDir, 'tenant', 'users.ts'), 'utf-8');

      // Primary key with default
      expect(usersContent).toContain("id: uuid('id').primaryKey().defaultRandom()");
      // Required varchar
      expect(usersContent).toContain("email: varchar('email', { length: 255 }).notNull()");
      // Nullable text (should not have .notNull())
      expect(usersContent).toContain("name: text('name')");
      expect(usersContent).not.toMatch(/name: text\('name'\)\.notNull\(\)/);
      // Boolean with default
      expect(usersContent).toContain("is_active: boolean('is_active').notNull().default(true)");
      // Timestamp with default
      expect(usersContent).toContain(".defaultNow()");
    });

    it('should generate index definitions', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
      };

      await importer.import(mockSchemaExport, options);

      const usersContent = await readFile(join(testDir, 'tenant', 'users.ts'), 'utf-8');

      expect(usersContent).toContain('export const usersIndexes = {');
      expect(usersContent).toContain("uniqueIndex('users_email_idx')");
      expect(usersContent).toContain('.on(users.email)');
    });

    it('should add foreign key references as comments', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
      };

      await importer.import(mockSchemaExport, options);

      const ordersContent = await readFile(join(testDir, 'tenant', 'orders.ts'), 'utf-8');

      // Foreign key reference should be commented
      expect(ordersContent).toContain('// .references(() => users.id)');
      // Should have TODO comment for import
      expect(ordersContent).toContain('TODO: Adjust import path for users');
    });

    it('should generate TypeScript types by default', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
        includeTypes: true,
      };

      await importer.import(mockSchemaExport, options);

      const usersContent = await readFile(join(testDir, 'tenant', 'users.ts'), 'utf-8');

      expect(usersContent).toContain('export type Users = typeof users.$inferSelect');
      expect(usersContent).toContain('export type NewUsers = typeof users.$inferInsert');
    });

    it('should include Zod schemas when requested', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
        includeZod: true,
      };

      await importer.import(mockSchemaExport, options);

      const usersContent = await readFile(join(testDir, 'tenant', 'users.ts'), 'utf-8');

      expect(usersContent).toContain("from 'drizzle-zod'");
      expect(usersContent).toContain("from 'zod'");
      expect(usersContent).toContain('export const insertUsersSchema = createInsertSchema(users)');
      expect(usersContent).toContain('export const selectUsersSchema = createSelectSchema(users)');
    });

    it('should generate barrel files', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
      };

      await importer.import(mockSchemaExport, options);

      const tenantIndex = await readFile(join(testDir, 'tenant', 'index.ts'), 'utf-8');
      const sharedIndex = await readFile(join(testDir, 'shared', 'index.ts'), 'utf-8');

      expect(tenantIndex).toContain("export * from './users'");
      expect(tenantIndex).toContain("export * from './orders'");
      expect(sharedIndex).toContain("export * from './plans'");
    });

    it('should skip existing files without overwrite', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
        overwrite: false,
      };

      // First import
      await importer.import(mockSchemaExport, options);

      // Second import should skip
      const result = await importer.import(mockSchemaExport, options);

      expect(result.filesSkipped.length).toBeGreaterThan(0);
      expect(result.filesCreated).toHaveLength(0);
    });

    it('should overwrite existing files when requested', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
        overwrite: true,
      };

      // First import
      await importer.import(mockSchemaExport, options);

      // Second import should overwrite
      const result = await importer.import(mockSchemaExport, options);

      expect(result.filesSkipped).toHaveLength(0);
      expect(result.filesCreated.length).toBeGreaterThan(0);
    });

    it('should support dry run mode', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
        dryRun: true,
      };

      const result = await importer.import(mockSchemaExport, options);

      // Should report files that would be created
      expect(result.filesCreated.length).toBeGreaterThan(0);

      // But files should not actually exist
      const { access } = await import('node:fs/promises');
      for (const file of result.filesCreated) {
        await expect(access(file)).rejects.toThrow();
      }
    });

    it('should skip tenant schemas when disabled', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
        generateTenant: false,
        generateShared: true,
      };

      const result = await importer.import(mockSchemaExport, options);

      expect(result.filesCreated.filter((f) => f.includes('/tenant/'))).toHaveLength(0);
      expect(result.filesCreated.filter((f) => f.includes('/shared/'))).not.toHaveLength(0);
    });

    it('should skip shared schemas when disabled', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
        generateTenant: true,
        generateShared: false,
      };

      const result = await importer.import(mockSchemaExport, options);

      expect(result.filesCreated.filter((f) => f.includes('/shared/'))).toHaveLength(0);
      expect(result.filesCreated.filter((f) => f.includes('/tenant/'))).not.toHaveLength(0);
    });

    it('should handle various data types', async () => {
      const options: ImportOptions = {
        outputDir: testDir,
      };

      await importer.import(mockSchemaExport, options);

      const plansContent = await readFile(join(testDir, 'shared', 'plans.ts'), 'utf-8');

      expect(plansContent).toContain("uuid('id')");
      expect(plansContent).toContain("varchar('name', { length: 100 })");
      expect(plansContent).toContain("integer('price')");
      expect(plansContent).toContain("jsonb('features')");
    });
  });

  describe('data type mapping', () => {
    const dataTypeCases = [
      { dataType: 'uuid', expected: "uuid('test')" },
      { dataType: 'text', expected: "text('test')" },
      { dataType: 'varchar(255)', expected: "varchar('test', { length: 255 })" },
      { dataType: 'char(10)', expected: "char('test', { length: 10 })" },
      { dataType: 'integer', expected: "integer('test')" },
      { dataType: 'smallint', expected: "smallint('test')" },
      { dataType: 'bigint', expected: "bigint('test', { mode: 'number' })" },
      { dataType: 'serial', expected: "serial('test')" },
      { dataType: 'bigserial', expected: "bigserial('test', { mode: 'number' })" },
      { dataType: 'real', expected: "real('test')" },
      { dataType: 'double precision', expected: "doublePrecision('test')" },
      { dataType: 'numeric(10,2)', expected: "numeric('test', { precision: 10, scale: 2 })" },
      { dataType: 'boolean', expected: "boolean('test')" },
      { dataType: 'date', expected: "date('test')" },
      { dataType: 'timestamp', expected: "timestamp('test')" },
      {
        dataType: 'timestamp with time zone',
        expected: "timestamp('test', { withTimezone: true })",
      },
      { dataType: 'time', expected: "time('test')" },
      { dataType: 'json', expected: "json('test')" },
      { dataType: 'jsonb', expected: "jsonb('test')" },
    ];

    dataTypeCases.forEach(({ dataType, expected }) => {
      it(`should map ${dataType} correctly`, async () => {
        const schemaExport: SchemaExport = {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          tables: [
            {
              name: 'test_table',
              schemaType: 'tenant',
              columns: [
                {
                  name: 'test',
                  dataType,
                  isPrimaryKey: false,
                  isNullable: false,
                  hasDefault: false,
                },
              ],
              indexes: [],
            },
          ],
        };

        const options: ImportOptions = {
          outputDir: testDir,
        };

        await importer.import(schemaExport, options);

        const content = await readFile(join(testDir, 'tenant', 'test_table.ts'), 'utf-8');
        expect(content).toContain(expected);
      });
    });
  });
});
