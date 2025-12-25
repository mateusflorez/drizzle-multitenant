import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cloner, createCloner } from './cloner.js';
import type { ClonerConfig, ClonerDependencies } from './types.js';

describe('Cloner', () => {
  let cloner: Cloner;
  let mockConfig: ClonerConfig;
  let mockDeps: ClonerDependencies;
  let mockPool: any;
  let mockRootPool: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      end: vi.fn().mockResolvedValue(undefined),
    };

    mockRootPool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      end: vi.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      migrationsTable: '__drizzle_migrations',
    };

    mockDeps = {
      createPool: vi.fn().mockResolvedValue(mockPool),
      createRootPool: vi.fn().mockResolvedValue(mockRootPool),
      schemaNameTemplate: (id) => `tenant_${id}`,
      schemaExists: vi.fn(),
      createSchema: vi.fn().mockResolvedValue(undefined),
    };

    cloner = new Cloner(mockConfig, mockDeps);
  });

  describe('createCloner factory', () => {
    it('should create a Cloner instance', () => {
      const instance = createCloner(mockConfig, mockDeps);
      expect(instance).toBeInstanceOf(Cloner);
    });
  });

  describe('cloneTenant', () => {
    it('should fail if source tenant does not exist', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await cloner.cloneTenant('source', 'target');

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
      expect(result.sourceTenant).toBe('source');
      expect(result.targetTenant).toBe('target');
    });

    it('should fail if target tenant already exists', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true) // source exists
        .mockResolvedValueOnce(true); // target exists

      const result = await cloner.cloneTenant('source', 'target');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should clone empty schema successfully', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true) // source exists
        .mockResolvedValueOnce(false); // target does not exist

      // Source has no tables
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await cloner.cloneTenant('source', 'target');

      expect(result.success).toBe(true);
      expect(result.tables).toHaveLength(0);
      expect(mockDeps.createSchema).toHaveBeenCalledWith('target');
    });

    it('should clone schema with tables', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      // Use implementation-based mocking for parallel queries
      let listTablesCalled = false;
      mockPool.query.mockImplementation((sql: string) => {
        // listTables query
        if (sql.includes('information_schema.tables') && sql.includes('table_type')) {
          listTablesCalled = true;
          return Promise.resolve({ rows: [{ table_name: 'users' }], rowCount: 1 });
        }
        // columns query
        if (sql.includes('information_schema.columns') && sql.includes('ordinal_position')) {
          return Promise.resolve({
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
        }
        // indexes query
        if (sql.includes('pg_indexes')) {
          return Promise.resolve({ rows: [] });
        }
        // row count query
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [{ count: '10' }] });
        }
        // constraints queries (pk, fk, unique, check)
        return Promise.resolve({ rows: [] });
      });

      const result = await cloner.cloneTenant('source', 'target');

      expect(result.success).toBe(true);
      expect(result.tables).toContain('users');
      expect(mockDeps.createSchema).toHaveBeenCalledWith('target');
    });

    it('should copy data when includeData is true', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      // Use implementation-based mocking for parallel queries
      mockPool.query.mockImplementation((sql: string) => {
        // listTables query
        if (sql.includes('information_schema.tables') && sql.includes('table_type')) {
          return Promise.resolve({ rows: [{ table_name: 'users' }] });
        }
        // columns query
        if (sql.includes('information_schema.columns') && sql.includes('ordinal_position')) {
          return Promise.resolve({
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
            ],
          });
        }
        // indexes query
        if (sql.includes('pg_indexes')) {
          return Promise.resolve({ rows: [] });
        }
        // row count query
        if (sql.includes('count(*)')) {
          return Promise.resolve({ rows: [{ count: '5' }] });
        }
        // constraints queries (pk, fk, unique, check)
        return Promise.resolve({ rows: [] });
      });

      // Mock for DDL and data copy (rootPool handles different queries)
      mockRootPool.query.mockImplementation((sql: string) => {
        // FK dependency query for copy order
        if (sql.includes('FOREIGN KEY') && sql.includes('constraint_column_usage')) {
          return Promise.resolve({ rows: [] });
        }
        // Column names for data copy
        if (sql.includes('information_schema.columns') && sql.includes('column_name')) {
          return Promise.resolve({ rows: [{ column_name: 'id' }] });
        }
        // SET session_replication_role
        if (sql.includes('session_replication_role')) {
          return Promise.resolve({ rows: [] });
        }
        // INSERT...SELECT or DDL queries
        return Promise.resolve({ rowCount: 5, rows: [] });
      });

      const result = await cloner.cloneTenant('source', 'target', {
        includeData: true,
      });

      expect(result.success).toBe(true);
      expect(result.rowsCopied).toBeDefined();
    });

    it('should call progress callback', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      mockRootPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const onProgress = vi.fn();

      await cloner.cloneTenant('source', 'target', { onProgress });

      expect(onProgress).toHaveBeenCalledWith('starting');
      expect(onProgress).toHaveBeenCalledWith('introspecting');
      expect(onProgress).toHaveBeenCalledWith('creating_schema');
      expect(onProgress).toHaveBeenCalledWith('completed');
    });

    it('should return correct target schema name', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await cloner.cloneTenant('source', 'target');

      expect(result.targetSchema).toBe('tenant_target');
    });

    it('should track duration', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await cloner.cloneTenant('source', 'target');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should exclude migrations table from cloning', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      // Simulate listTables query - verify migrations table is excluded
      mockPool.query.mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('information_schema.tables')) {
          // Check that migrations table is in the exclusion list
          expect(params).toContain('__drizzle_migrations');
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await cloner.cloneTenant('source', 'target');

      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should cleanup pools on error', async () => {
      (mockDeps.schemaExists as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      mockPool.query.mockRejectedValue(new Error('Database error'));

      const result = await cloner.cloneTenant('source', 'target');

      expect(result.success).toBe(false);
      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
