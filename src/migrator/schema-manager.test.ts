import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchemaManager, createSchemaManager } from './schema-manager.js';
import type { Config } from '../types.js';

// Mock pg Pool
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));

  return { Pool: MockPool };
});

describe('SchemaManager', () => {
  let schemaManager: SchemaManager<Record<string, unknown>, Record<string, unknown>>;
  let mockConfig: Config<Record<string, unknown>, Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      connection: {
        url: 'postgresql://localhost:5432/test',
        poolConfig: { max: 5 },
      },
      isolation: {
        strategy: 'schema',
        schemaNameTemplate: (id) => `tenant_${id}`,
        maxPools: 10,
      },
      schemas: {
        tenant: {},
        shared: {},
      },
    };

    schemaManager = new SchemaManager(mockConfig);
  });

  describe('createSchemaManager factory', () => {
    it('should create a SchemaManager instance', () => {
      const manager = createSchemaManager(mockConfig);
      expect(manager).toBeInstanceOf(SchemaManager);
    });

    it('should accept custom migrations table name', () => {
      const manager = createSchemaManager(mockConfig, 'custom_migrations');
      expect(manager.getMigrationsTableName()).toBe('custom_migrations');
    });
  });

  describe('getSchemaName', () => {
    it('should return schema name using template', () => {
      const schemaName = schemaManager.getSchemaName('tenant-123');
      expect(schemaName).toBe('tenant_tenant-123');
    });

    it('should work with different templates', () => {
      const customConfig = {
        ...mockConfig,
        isolation: {
          ...mockConfig.isolation,
          schemaNameTemplate: (id: string) => `custom_${id}_schema`,
        },
      };

      const manager = new SchemaManager(customConfig);
      expect(manager.getSchemaName('test')).toBe('custom_test_schema');
    });
  });

  describe('createPool', () => {
    it('should create a pool with search_path set', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      await schemaManager.createPool('tenant_123');

      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://localhost:5432/test',
          options: '-c search_path="tenant_123",public',
        })
      );
    });
  });

  describe('createRootPool', () => {
    it('should create a pool without search_path', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      await schemaManager.createRootPool();

      expect(Pool).toHaveBeenCalledWith(
        expect.not.objectContaining({
          options: expect.any(String),
        })
      );
    });
  });

  describe('createSchema', () => {
    it('should execute CREATE SCHEMA IF NOT EXISTS', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      const endMock = vi.fn().mockResolvedValue(undefined);

      Pool.mockImplementation(() => ({
        query: queryMock,
        end: endMock,
        on: vi.fn(),
      }));

      await schemaManager.createSchema('new-tenant');

      expect(queryMock).toHaveBeenCalledWith(
        'CREATE SCHEMA IF NOT EXISTS "tenant_new-tenant"'
      );
      expect(endMock).toHaveBeenCalled();
    });
  });

  describe('dropSchema', () => {
    it('should execute DROP SCHEMA with CASCADE by default', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      const endMock = vi.fn().mockResolvedValue(undefined);

      Pool.mockImplementation(() => ({
        query: queryMock,
        end: endMock,
        on: vi.fn(),
      }));

      await schemaManager.dropSchema('old-tenant');

      expect(queryMock).toHaveBeenCalledWith(
        'DROP SCHEMA IF EXISTS "tenant_old-tenant" CASCADE'
      );
    });

    it('should use RESTRICT when cascade is false', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      const endMock = vi.fn().mockResolvedValue(undefined);

      Pool.mockImplementation(() => ({
        query: queryMock,
        end: endMock,
        on: vi.fn(),
      }));

      await schemaManager.dropSchema('old-tenant', { cascade: false });

      expect(queryMock).toHaveBeenCalledWith(
        'DROP SCHEMA IF EXISTS "tenant_old-tenant" RESTRICT'
      );
    });
  });

  describe('schemaExists', () => {
    it('should return true when schema exists', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [{ schema_name: 'tenant_123' }], rowCount: 1 }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));

      const exists = await schemaManager.schemaExists('123');

      expect(exists).toBe(true);
    });

    it('should return false when schema does not exist', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));

      const exists = await schemaManager.schemaExists('non-existent');

      expect(exists).toBe(false);
    });
  });

  describe('listSchemas', () => {
    it('should list all schemas excluding system schemas', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({
          rows: [
            { schema_name: 'public' },
            { schema_name: 'tenant_1' },
            { schema_name: 'tenant_2' },
          ],
        }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));

      const schemas = await schemaManager.listSchemas();

      expect(schemas).toEqual(['public', 'tenant_1', 'tenant_2']);
    });

    it('should filter by pattern when provided', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      const queryMock = vi.fn().mockResolvedValue({
        rows: [
          { schema_name: 'tenant_1' },
          { schema_name: 'tenant_2' },
        ],
      });

      Pool.mockImplementation(() => ({
        query: queryMock,
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));

      const schemas = await schemaManager.listSchemas('tenant_%');

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('LIKE $1'),
        ['tenant_%']
      );
      expect(schemas).toEqual(['tenant_1', 'tenant_2']);
    });
  });

  describe('ensureMigrationsTable', () => {
    it('should create migrations table with name format', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });

      Pool.mockImplementation(() => ({
        query: queryMock,
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));

      const pool = await schemaManager.createPool('tenant_123');

      await schemaManager.ensureMigrationsTable(pool, 'tenant_123', {
        format: 'name',
        tableName: '__drizzle_migrations',
        columns: {
          identifier: 'name',
          timestamp: 'applied_at',
          timestampType: 'timestamp',
        },
      });

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS')
      );
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('name VARCHAR(255) NOT NULL UNIQUE')
      );
    });

    it('should create migrations table with hash format', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });

      Pool.mockImplementation(() => ({
        query: queryMock,
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));

      const pool = await schemaManager.createPool('tenant_123');

      await schemaManager.ensureMigrationsTable(pool, 'tenant_123', {
        format: 'hash',
        tableName: '__drizzle_migrations',
        columns: {
          identifier: 'hash',
          timestamp: 'created_at',
          timestampType: 'bigint',
        },
      });

      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('hash TEXT NOT NULL')
      );
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('BIGINT NOT NULL')
      );
    });
  });

  describe('migrationsTableExists', () => {
    it('should return true when table exists', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [{}], rowCount: 1 }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));

      const pool = await schemaManager.createPool('tenant_123');
      const exists = await schemaManager.migrationsTableExists(pool, 'tenant_123');

      expect(exists).toBe(true);
    });

    it('should return false when table does not exist', async () => {
      const Pool = (await import('pg')).Pool as unknown as ReturnType<typeof vi.fn>;

      Pool.mockImplementation(() => ({
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        end: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }));

      const pool = await schemaManager.createPool('tenant_123');
      const exists = await schemaManager.migrationsTableExists(pool, 'tenant_123');

      expect(exists).toBe(false);
    });
  });

  describe('getMigrationsTableName', () => {
    it('should return default table name', () => {
      expect(schemaManager.getMigrationsTableName()).toBe('__drizzle_migrations');
    });

    it('should return custom table name', () => {
      const manager = new SchemaManager(mockConfig, 'custom_migrations');
      expect(manager.getMigrationsTableName()).toBe('custom_migrations');
    });
  });
});
