import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTables,
  generateTableDdl,
  generateIndexDdls,
  generatePrimaryKeyDdl,
  generateForeignKeyDdls,
  generateUniqueDdls,
  getRowCount,
} from './ddl-generator.js';
import type { Pool } from 'pg';

describe('ddl-generator', () => {
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
    };
  });

  describe('listTables', () => {
    it('should return list of table names', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { table_name: 'users' },
          { table_name: 'orders' },
        ],
      });

      const result = await listTables(mockPool as Pool, 'tenant_123', []);

      expect(result).toEqual(['users', 'orders']);
    });

    it('should exclude specified tables', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await listTables(mockPool as Pool, 'tenant_123', ['migrations', 'cache']);

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain('migrations');
      expect(call[1]).toContain('cache');
    });

    it('should handle empty tables list', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await listTables(mockPool as Pool, 'tenant_123', []);

      expect(result).toEqual([]);
    });
  });

  describe('generateTableDdl', () => {
    it('should generate CREATE TABLE with correct columns', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            column_name: 'id',
            data_type: 'integer',
            udt_name: 'int4',
            is_nullable: 'NO',
            column_default: null,
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null,
          },
          {
            column_name: 'name',
            data_type: 'text',
            udt_name: 'text',
            is_nullable: 'YES',
            column_default: null,
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null,
          },
        ],
      });

      const ddl = await generateTableDdl(mockPool as Pool, 'tenant_123', 'users');

      expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "users"');
      expect(ddl).toContain('"id" int4 NOT NULL');
      expect(ddl).toContain('"name" text');
      expect(ddl).not.toContain('"name" text NOT NULL');
    });

    it('should handle varchar with length', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            column_name: 'email',
            data_type: 'character varying',
            udt_name: 'varchar',
            is_nullable: 'YES',
            column_default: null,
            character_maximum_length: 255,
            numeric_precision: null,
            numeric_scale: null,
          },
        ],
      });

      const ddl = await generateTableDdl(mockPool as Pool, 'tenant_123', 'users');

      expect(ddl).toContain('"email" varchar(255)');
    });

    it('should handle numeric with precision and scale', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            column_name: 'price',
            data_type: 'numeric',
            udt_name: 'numeric',
            is_nullable: 'YES',
            column_default: null,
            character_maximum_length: null,
            numeric_precision: 10,
            numeric_scale: 2,
          },
        ],
      });

      const ddl = await generateTableDdl(mockPool as Pool, 'tenant_123', 'products');

      expect(ddl).toContain('"price" numeric(10, 2)');
    });

    it('should handle default values', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            column_name: 'status',
            data_type: 'text',
            udt_name: 'text',
            is_nullable: 'YES',
            column_default: "'active'::text",
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null,
          },
        ],
      });

      const ddl = await generateTableDdl(mockPool as Pool, 'tenant_123', 'users');

      expect(ddl).toContain("DEFAULT 'active'::text");
    });

    it('should handle array types', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            column_name: 'tags',
            data_type: 'ARRAY',
            udt_name: '_text',
            is_nullable: 'YES',
            column_default: null,
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null,
          },
        ],
      });

      const ddl = await generateTableDdl(mockPool as Pool, 'tenant_123', 'posts');

      expect(ddl).toContain('"tags" text[]');
    });
  });

  describe('generateIndexDdls', () => {
    it('should generate index DDLs with replaced schema', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            indexname: 'users_email_idx',
            indexdef: 'CREATE INDEX users_email_idx ON "source_schema"."users" USING btree (email)',
          },
        ],
      });

      const ddls = await generateIndexDdls(
        mockPool as Pool,
        'source_schema',
        'target_schema',
        'users'
      );

      expect(ddls).toHaveLength(1);
      expect(ddls[0]).toContain('"target_schema"');
      expect(ddls[0]).not.toContain('"source_schema"');
    });

    it('should exclude primary key indexes', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await generateIndexDdls(mockPool as Pool, 'source', 'target', 'users');

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("NOT LIKE '%_pkey'");
    });
  });

  describe('generatePrimaryKeyDdl', () => {
    it('should generate primary key DDL', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { constraint_name: 'users_pkey', column_name: 'id' },
        ],
      });

      const ddl = await generatePrimaryKeyDdl(mockPool as Pool, 'tenant_123', 'users');

      expect(ddl).toBe('ALTER TABLE "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id")');
    });

    it('should handle composite primary keys', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { constraint_name: 'order_items_pkey', column_name: 'order_id' },
          { constraint_name: 'order_items_pkey', column_name: 'product_id' },
        ],
      });

      const ddl = await generatePrimaryKeyDdl(mockPool as Pool, 'tenant_123', 'order_items');

      expect(ddl).toContain('"order_id", "product_id"');
    });

    it('should return null when no primary key', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const ddl = await generatePrimaryKeyDdl(mockPool as Pool, 'tenant_123', 'logs');

      expect(ddl).toBeNull();
    });
  });

  describe('generateForeignKeyDdls', () => {
    it('should generate foreign key DDL', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            constraint_name: 'orders_user_id_fkey',
            column_name: 'user_id',
            foreign_table_name: 'users',
            foreign_column_name: 'id',
            update_rule: 'NO ACTION',
            delete_rule: 'CASCADE',
          },
        ],
      });

      const ddls = await generateForeignKeyDdls(
        mockPool as Pool,
        'source_schema',
        'target_schema',
        'orders'
      );

      expect(ddls).toHaveLength(1);
      expect(ddls[0]).toContain('FOREIGN KEY ("user_id")');
      expect(ddls[0]).toContain('REFERENCES "target_schema"."users" ("id")');
      expect(ddls[0]).toContain('ON DELETE CASCADE');
    });

    it('should handle composite foreign keys', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            constraint_name: 'items_fkey',
            column_name: 'order_id',
            foreign_table_name: 'orders',
            foreign_column_name: 'id',
            update_rule: 'NO ACTION',
            delete_rule: 'NO ACTION',
          },
          {
            constraint_name: 'items_fkey',
            column_name: 'tenant_id',
            foreign_table_name: 'orders',
            foreign_column_name: 'tenant_id',
            update_rule: 'NO ACTION',
            delete_rule: 'NO ACTION',
          },
        ],
      });

      const ddls = await generateForeignKeyDdls(
        mockPool as Pool,
        'source',
        'target',
        'items'
      );

      expect(ddls).toHaveLength(1);
      expect(ddls[0]).toContain('"order_id", "tenant_id"');
    });
  });

  describe('generateUniqueDdls', () => {
    it('should generate unique constraint DDL', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { constraint_name: 'users_email_key', column_name: 'email' },
        ],
      });

      const ddls = await generateUniqueDdls(mockPool as Pool, 'tenant_123', 'users');

      expect(ddls).toHaveLength(1);
      expect(ddls[0]).toBe('ALTER TABLE "users" ADD CONSTRAINT "users_email_key" UNIQUE ("email")');
    });

    it('should handle composite unique constraints', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { constraint_name: 'users_tenant_email_key', column_name: 'tenant_id' },
          { constraint_name: 'users_tenant_email_key', column_name: 'email' },
        ],
      });

      const ddls = await generateUniqueDdls(mockPool as Pool, 'tenant_123', 'users');

      expect(ddls).toHaveLength(1);
      expect(ddls[0]).toContain('"tenant_id", "email"');
    });
  });

  describe('getRowCount', () => {
    it('should return row count', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ count: '1000' }],
      });

      const count = await getRowCount(mockPool as Pool, 'tenant_123', 'users');

      expect(count).toBe(1000);
    });

    it('should return 0 for empty table', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ count: '0' }],
      });

      const count = await getRowCount(mockPool as Pool, 'tenant_123', 'users');

      expect(count).toBe(0);
    });
  });
});
