import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { DriftDetector, createDriftDetector } from './drift-detector.js';
import { compareColumns, normalizeDefault, introspectColumns } from './column-analyzer.js';
import { compareIndexes, introspectIndexes } from './index-analyzer.js';
import { compareConstraints, introspectConstraints } from './constraint-analyzer.js';
import type { ColumnInfo, IndexInfo, ConstraintInfo, TenantSchema } from './types.js';

// Mock SchemaManager
const createMockSchemaManager = () => ({
  createPool: vi.fn(),
  getSchemaName: vi.fn((id: string) => `tenant_${id}`),
});

// Mock Pool
const createMockPool = (queryResults: Record<string, QueryResult<any>>) => {
  const mockPool = {
    query: vi.fn((sql: string) => {
      for (const [pattern, result] of Object.entries(queryResults)) {
        if (sql.includes(pattern)) {
          return Promise.resolve(result);
        }
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pool;
  return mockPool;
};

// Mock Config
const mockConfig = {
  connection: { url: 'postgres://localhost/test' },
  isolation: {
    strategy: 'schema' as const,
    schemaNameTemplate: (id: string) => `tenant_${id}`,
  },
  schemas: { tenant: {} },
};

describe('Column Analyzer', () => {
  describe('normalizeDefault', () => {
    it('should return null for null input', () => {
      expect(normalizeDefault(null)).toBeNull();
    });

    it('should remove type cast from quoted string', () => {
      expect(normalizeDefault("'123'::integer")).toBe('123');
    });

    it('should remove type cast from value', () => {
      expect(normalizeDefault('now()::timestamp')).toBe('now()');
    });

    it('should trim whitespace', () => {
      expect(normalizeDefault('  value  ')).toBe('value');
    });
  });

  describe('compareColumns', () => {
    const baseColumn: ColumnInfo = {
      name: 'id',
      dataType: 'integer',
      udtName: 'int4',
      isNullable: false,
      columnDefault: null,
      characterMaximumLength: null,
      numericPrecision: 32,
      numericScale: 0,
      ordinalPosition: 1,
    };

    it('should detect missing columns', () => {
      const reference = [baseColumn];
      const target: ColumnInfo[] = [];

      const drifts = compareColumns(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        column: 'id',
        type: 'missing',
        expected: 'integer',
      });
    });

    it('should detect extra columns', () => {
      const reference: ColumnInfo[] = [];
      const target = [baseColumn];

      const drifts = compareColumns(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        column: 'id',
        type: 'extra',
        actual: 'integer',
      });
    });

    it('should detect type mismatch', () => {
      const reference = [baseColumn];
      const target = [{ ...baseColumn, udtName: 'int8' }];

      const drifts = compareColumns(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        column: 'id',
        type: 'type_mismatch',
        expected: 'int4',
        actual: 'int8',
      });
    });

    it('should detect nullable mismatch', () => {
      const reference = [baseColumn];
      const target = [{ ...baseColumn, isNullable: true }];

      const drifts = compareColumns(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        column: 'id',
        type: 'nullable_mismatch',
        expected: false,
        actual: true,
      });
    });

    it('should detect default mismatch', () => {
      const reference = [{ ...baseColumn, columnDefault: '0' }];
      const target = [{ ...baseColumn, columnDefault: '1' }];

      const drifts = compareColumns(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        column: 'id',
        type: 'default_mismatch',
      });
    });

    it('should return empty array for identical columns', () => {
      const reference = [baseColumn];
      const target = [baseColumn];

      const drifts = compareColumns(reference, target);

      expect(drifts).toHaveLength(0);
    });
  });

  describe('introspectColumns', () => {
    it('should query and map column information', async () => {
      const mockPool = createMockPool({
        'information_schema.columns': {
          rows: [
            {
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              column_default: null,
              character_maximum_length: null,
              numeric_precision: 32,
              numeric_scale: 0,
              ordinal_position: 1,
            },
          ],
          rowCount: 1,
        },
      });

      const columns = await introspectColumns(mockPool, 'tenant_123', 'users');

      expect(columns).toHaveLength(1);
      expect(columns[0]).toMatchObject({
        name: 'id',
        dataType: 'integer',
        udtName: 'int4',
        isNullable: false,
      });
    });
  });
});

describe('Index Analyzer', () => {
  describe('compareIndexes', () => {
    const baseIndex: IndexInfo = {
      name: 'users_pkey',
      columns: ['id'],
      isUnique: true,
      isPrimary: true,
      definition: 'CREATE UNIQUE INDEX users_pkey ON users USING btree (id)',
    };

    it('should detect missing indexes', () => {
      const reference = [baseIndex];
      const target: IndexInfo[] = [];

      const drifts = compareIndexes(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        index: 'users_pkey',
        type: 'missing',
      });
    });

    it('should detect extra indexes', () => {
      const reference: IndexInfo[] = [];
      const target = [baseIndex];

      const drifts = compareIndexes(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        index: 'users_pkey',
        type: 'extra',
      });
    });

    it('should detect definition mismatch (columns)', () => {
      const reference = [baseIndex];
      const target = [{ ...baseIndex, columns: ['id', 'name'] }];

      const drifts = compareIndexes(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        index: 'users_pkey',
        type: 'definition_mismatch',
      });
    });

    it('should detect definition mismatch (uniqueness)', () => {
      const reference = [baseIndex];
      const target = [{ ...baseIndex, isUnique: false }];

      const drifts = compareIndexes(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        index: 'users_pkey',
        type: 'definition_mismatch',
      });
    });

    it('should return empty array for identical indexes', () => {
      const reference = [baseIndex];
      const target = [baseIndex];

      const drifts = compareIndexes(reference, target);

      expect(drifts).toHaveLength(0);
    });
  });
});

describe('Constraint Analyzer', () => {
  describe('compareConstraints', () => {
    const baseConstraint: ConstraintInfo = {
      name: 'users_pkey',
      type: 'PRIMARY KEY',
      columns: ['id'],
    };

    it('should detect missing constraints', () => {
      const reference = [baseConstraint];
      const target: ConstraintInfo[] = [];

      const drifts = compareConstraints(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        constraint: 'users_pkey',
        type: 'missing',
      });
    });

    it('should detect extra constraints', () => {
      const reference: ConstraintInfo[] = [];
      const target = [baseConstraint];

      const drifts = compareConstraints(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        constraint: 'users_pkey',
        type: 'extra',
      });
    });

    it('should detect type mismatch', () => {
      const reference = [baseConstraint];
      const target = [{ ...baseConstraint, type: 'UNIQUE' as const }];

      const drifts = compareConstraints(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        constraint: 'users_pkey',
        type: 'definition_mismatch',
      });
    });

    it('should detect column mismatch', () => {
      const reference = [baseConstraint];
      const target = [{ ...baseConstraint, columns: ['id', 'name'] }];

      const drifts = compareConstraints(reference, target);

      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({
        constraint: 'users_pkey',
        type: 'definition_mismatch',
      });
    });

    it('should return empty array for identical constraints', () => {
      const reference = [baseConstraint];
      const target = [baseConstraint];

      const drifts = compareConstraints(reference, target);

      expect(drifts).toHaveLength(0);
    });
  });
});

describe('DriftDetector', () => {
  let mockSchemaManager: ReturnType<typeof createMockSchemaManager>;
  let detector: DriftDetector<Record<string, unknown>, Record<string, unknown>>;

  beforeEach(() => {
    mockSchemaManager = createMockSchemaManager();
    detector = createDriftDetector(mockConfig as any, mockSchemaManager as any, {
      migrationsTable: '__drizzle_migrations',
      tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
    });
  });

  describe('compareSchemas', () => {
    it('should detect no drift for identical schemas', () => {
      const schema: TenantSchema = {
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        tables: [
          {
            name: 'users',
            columns: [
              {
                name: 'id',
                dataType: 'integer',
                udtName: 'int4',
                isNullable: false,
                columnDefault: null,
                characterMaximumLength: null,
                numericPrecision: 32,
                numericScale: 0,
                ordinalPosition: 1,
              },
            ],
            indexes: [],
            constraints: [],
          },
        ],
        introspectedAt: new Date(),
      };

      const drift = detector.compareSchemas(schema, { ...schema, tenantId: 'tenant-2' });

      expect(drift.hasDrift).toBe(false);
      expect(drift.issueCount).toBe(0);
      expect(drift.tables).toHaveLength(0);
    });

    it('should detect missing table', () => {
      const reference: TenantSchema = {
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        tables: [
          {
            name: 'users',
            columns: [
              {
                name: 'id',
                dataType: 'integer',
                udtName: 'int4',
                isNullable: false,
                columnDefault: null,
                characterMaximumLength: null,
                numericPrecision: 32,
                numericScale: 0,
                ordinalPosition: 1,
              },
            ],
            indexes: [],
            constraints: [],
          },
        ],
        introspectedAt: new Date(),
      };

      const target: TenantSchema = {
        tenantId: 'tenant-2',
        schemaName: 'tenant_tenant-2',
        tables: [],
        introspectedAt: new Date(),
      };

      const drift = detector.compareSchemas(reference, target);

      expect(drift.hasDrift).toBe(true);
      expect(drift.tables).toHaveLength(1);
      expect(drift.tables[0]).toMatchObject({
        table: 'users',
        status: 'missing',
      });
    });

    it('should detect extra table', () => {
      const reference: TenantSchema = {
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        tables: [],
        introspectedAt: new Date(),
      };

      const target: TenantSchema = {
        tenantId: 'tenant-2',
        schemaName: 'tenant_tenant-2',
        tables: [
          {
            name: 'extra_table',
            columns: [
              {
                name: 'id',
                dataType: 'integer',
                udtName: 'int4',
                isNullable: false,
                columnDefault: null,
                characterMaximumLength: null,
                numericPrecision: 32,
                numericScale: 0,
                ordinalPosition: 1,
              },
            ],
            indexes: [],
            constraints: [],
          },
        ],
        introspectedAt: new Date(),
      };

      const drift = detector.compareSchemas(reference, target);

      expect(drift.hasDrift).toBe(true);
      expect(drift.tables).toHaveLength(1);
      expect(drift.tables[0]).toMatchObject({
        table: 'extra_table',
        status: 'extra',
      });
    });

    it('should detect column drift in existing table', () => {
      const baseTable = {
        name: 'users',
        indexes: [],
        constraints: [],
      };

      const reference: TenantSchema = {
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        tables: [
          {
            ...baseTable,
            columns: [
              {
                name: 'id',
                dataType: 'integer',
                udtName: 'int4',
                isNullable: false,
                columnDefault: null,
                characterMaximumLength: null,
                numericPrecision: 32,
                numericScale: 0,
                ordinalPosition: 1,
              },
            ],
          },
        ],
        introspectedAt: new Date(),
      };

      const target: TenantSchema = {
        tenantId: 'tenant-2',
        schemaName: 'tenant_tenant-2',
        tables: [
          {
            ...baseTable,
            columns: [
              {
                name: 'id',
                dataType: 'bigint',
                udtName: 'int8',
                isNullable: false,
                columnDefault: null,
                characterMaximumLength: null,
                numericPrecision: 64,
                numericScale: 0,
                ordinalPosition: 1,
              },
            ],
          },
        ],
        introspectedAt: new Date(),
      };

      const drift = detector.compareSchemas(reference, target);

      expect(drift.hasDrift).toBe(true);
      expect(drift.tables).toHaveLength(1);
      expect(drift.tables[0]).toMatchObject({
        table: 'users',
        status: 'drifted',
      });
      expect(drift.tables[0]!.columns).toHaveLength(1);
      expect(drift.tables[0]!.columns[0]).toMatchObject({
        column: 'id',
        type: 'type_mismatch',
      });
    });

    it('should skip index comparison when includeIndexes is false', () => {
      const baseColumn = {
        name: 'id',
        dataType: 'integer',
        udtName: 'int4',
        isNullable: false,
        columnDefault: null,
        characterMaximumLength: null,
        numericPrecision: 32,
        numericScale: 0,
        ordinalPosition: 1,
      };

      const reference: TenantSchema = {
        tenantId: 'tenant-1',
        schemaName: 'tenant_tenant-1',
        tables: [
          {
            name: 'users',
            columns: [baseColumn],
            indexes: [
              {
                name: 'users_pkey',
                columns: ['id'],
                isUnique: true,
                isPrimary: true,
                definition: 'CREATE UNIQUE INDEX users_pkey ON users (id)',
              },
            ],
            constraints: [],
          },
        ],
        introspectedAt: new Date(),
      };

      const target: TenantSchema = {
        tenantId: 'tenant-2',
        schemaName: 'tenant_tenant-2',
        tables: [
          {
            name: 'users',
            columns: [baseColumn],
            indexes: [], // Missing index
            constraints: [],
          },
        ],
        introspectedAt: new Date(),
      };

      const drift = detector.compareSchemas(reference, target, { includeIndexes: false });

      expect(drift.hasDrift).toBe(false);
      expect(drift.issueCount).toBe(0);
    });
  });

  describe('detectDrift', () => {
    it('should return empty result for no tenants', async () => {
      const emptyDetector = createDriftDetector(mockConfig as any, mockSchemaManager as any, {
        migrationsTable: '__drizzle_migrations',
        tenantDiscovery: async () => [],
      });

      const result = await emptyDetector.detectDrift();

      expect(result.total).toBe(0);
      expect(result.noDrift).toBe(0);
      expect(result.withDrift).toBe(0);
      expect(result.details).toHaveLength(0);
    });
  });

  describe('createDriftDetector', () => {
    it('should create a DriftDetector instance', () => {
      const instance = createDriftDetector(mockConfig as any, mockSchemaManager as any, {
        tenantDiscovery: async () => [],
      });

      expect(instance).toBeInstanceOf(DriftDetector);
    });
  });
});
