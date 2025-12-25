import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonSchemaExporter, createJsonSchemaExporter } from './json-schema-exporter.js';
import { TypeScriptExporter, createTypeScriptExporter } from './typescript-exporter.js';
import { MermaidExporter, createMermaidExporter } from './mermaid-exporter.js';
import { SchemaExporter, createSchemaExporter } from './schema-exporter.js';
import type { ExportedTable, ExportOptions } from './types.js';

const mockTables: ExportedTable[] = [
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
        defaultValue: null,
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
        dataType: 'timestamp',
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
    filePath: '/path/to/users.ts',
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
      {
        name: 'status',
        dataType: 'text',
        isPrimaryKey: false,
        isNullable: false,
        hasDefault: true,
        defaultValue: "'pending'",
      },
    ],
    indexes: [
      {
        name: 'orders_user_id_idx',
        columns: ['user_id'],
        isUnique: false,
      },
    ],
    filePath: '/path/to/orders.ts',
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
    ],
    indexes: [],
    filePath: '/path/to/plans.ts',
  },
];

describe('JsonSchemaExporter', () => {
  let exporter: JsonSchemaExporter;

  beforeEach(() => {
    exporter = createJsonSchemaExporter();
  });

  it('should export tables to JSON Schema format', () => {
    const options: ExportOptions = {
      format: 'json',
      projectName: 'test-project',
    };

    const result = exporter.export(mockTables, options);
    const parsed = JSON.parse(result);

    expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(parsed.$id).toBe('test-project/schemas');
    expect(parsed.title).toBe('test-project Database Schemas');
    expect(parsed.definitions).toBeDefined();
  });

  it('should create definitions for all tables', () => {
    const options: ExportOptions = { format: 'json' };
    const result = exporter.export(mockTables, options);
    const parsed = JSON.parse(result);

    expect(parsed.definitions.Users).toBeDefined();
    expect(parsed.definitions.Orders).toBeDefined();
    expect(parsed.definitions.Plans).toBeDefined();
  });

  it('should map data types correctly', () => {
    const options: ExportOptions = { format: 'json' };
    const result = exporter.export(mockTables, options);
    const parsed = JSON.parse(result);

    // UUID should be string with uuid format
    expect(parsed.definitions.Users.properties.id.type).toBe('string');
    expect(parsed.definitions.Users.properties.id.format).toBe('uuid');

    // Boolean
    expect(parsed.definitions.Users.properties.is_active.type).toBe('boolean');

    // Timestamp
    expect(parsed.definitions.Users.properties.created_at.type).toBe('string');
    expect(parsed.definitions.Users.properties.created_at.format).toBe('date-time');

    // Integer
    expect(parsed.definitions.Plans.properties.price.type).toBe('integer');

    // Numeric
    expect(parsed.definitions.Orders.properties.total.type).toBe('number');
  });

  it('should handle nullable columns', () => {
    const options: ExportOptions = { format: 'json' };
    const result = exporter.export(mockTables, options);
    const parsed = JSON.parse(result);

    // Non-nullable without default should be required
    expect(parsed.definitions.Users.required).toContain('email');

    // Nullable column type should include null
    expect(parsed.definitions.Users.properties.name.type).toEqual(['string', 'null']);
  });

  it('should include foreign key references', () => {
    const options: ExportOptions = { format: 'json' };
    const result = exporter.export(mockTables, options);
    const parsed = JSON.parse(result);

    expect(parsed.definitions.Orders.properties.user_id.$ref).toBe('#/definitions/Users');
    expect(parsed.definitions.Orders.properties.user_id.description).toContain(
      'Foreign key to users.id'
    );
  });

  it('should handle default values', () => {
    const options: ExportOptions = { format: 'json' };
    const result = exporter.export(mockTables, options);
    const parsed = JSON.parse(result);

    expect(parsed.definitions.Users.properties.is_active.default).toBe(true);
    expect(parsed.definitions.Plans.properties.price.default).toBe(0);
  });
});

describe('TypeScriptExporter', () => {
  let exporter: TypeScriptExporter;

  beforeEach(() => {
    exporter = createTypeScriptExporter();
  });

  it('should export to TypeScript format', () => {
    const options: ExportOptions = {
      format: 'typescript',
      projectName: 'test-project',
    };

    const result = exporter.export(mockTables, options);

    expect(result).toContain('Auto-generated TypeScript types');
    expect(result).toContain('export interface Users');
    expect(result).toContain('export interface Orders');
    expect(result).toContain('export interface Plans');
  });

  it('should separate tenant and shared schemas', () => {
    const options: ExportOptions = { format: 'typescript' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('// Tenant Schema Types');
    expect(result).toContain('// Shared Schema Types');
  });

  it('should map data types correctly', () => {
    const options: ExportOptions = { format: 'typescript' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('id?: string;'); // UUID with default
    expect(result).toContain('email: string;'); // Required varchar
    expect(result).toContain('name?: string | null;'); // Nullable text
    expect(result).toContain('is_active?: boolean;'); // Boolean with default
    expect(result).toContain('created_at?: Date;'); // Timestamp with default
    expect(result).toContain('total: number;'); // Numeric
    expect(result).toContain('price?: number;'); // Integer with default
  });

  it('should generate insert types', () => {
    const options: ExportOptions = {
      format: 'typescript',
      typescript: { includeInsertTypes: true },
    };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('export interface NewUsers');
    expect(result).toContain('export interface NewOrders');
    expect(result).toContain('export interface NewPlans');
  });

  it('should include Zod schemas when requested', () => {
    const options: ExportOptions = {
      format: 'typescript',
      typescript: { includeZod: true },
    };
    const result = exporter.export(mockTables, options);

    expect(result).toContain("import { z } from 'zod'");
    expect(result).toContain('export const usersSchema = z.object(');
    expect(result).toContain('export const ordersSchema = z.object(');
    expect(result).toContain('z.string().uuid()');
    expect(result).toContain('z.boolean()');
    expect(result).toContain('z.number()');
  });

  it('should add JSDoc comments for special columns', () => {
    const options: ExportOptions = { format: 'typescript' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('/** Primary key */');
    expect(result).toContain('Foreign key to users.id');
  });

  it('should exclude insert types when disabled', () => {
    const options: ExportOptions = {
      format: 'typescript',
      typescript: { includeInsertTypes: false },
    };
    const result = exporter.export(mockTables, options);

    expect(result).not.toContain('export interface NewUsers');
  });

  it('should exclude select types when disabled', () => {
    const options: ExportOptions = {
      format: 'typescript',
      typescript: { includeSelectTypes: false },
    };
    const result = exporter.export(mockTables, options);

    expect(result).not.toContain('export interface Users {');
  });
});

describe('MermaidExporter', () => {
  let exporter: MermaidExporter;

  beforeEach(() => {
    exporter = createMermaidExporter();
  });

  it('should export to Mermaid ERD format', () => {
    const options: ExportOptions = { format: 'mermaid' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('```mermaid');
    expect(result).toContain('erDiagram');
    expect(result).toContain('```');
  });

  it('should include all tables', () => {
    const options: ExportOptions = { format: 'mermaid' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('users {');
    expect(result).toContain('orders {');
    expect(result).toContain('plans {');
  });

  it('should include data types by default', () => {
    const options: ExportOptions = {
      format: 'mermaid',
      mermaid: { includeDataTypes: true },
    };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('uuid id PK');
    expect(result).toContain('varchar email');
    expect(result).toContain('text name');
    expect(result).toContain('bool is_active');
    expect(result).toContain('timestamp created_at');
  });

  it('should show primary and foreign keys', () => {
    const options: ExportOptions = {
      format: 'mermaid',
      mermaid: { showPrimaryKeys: true, showForeignKeys: true },
    };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('PK');
    expect(result).toContain('FK');
  });

  it('should generate relationships', () => {
    const options: ExportOptions = { format: 'mermaid' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('users ||--o{ orders');
    expect(result).toContain('"user_id -> id"');
  });

  it('should separate tenant and shared schemas with comments', () => {
    const options: ExportOptions = { format: 'mermaid' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('%% Tenant Schema Tables');
    expect(result).toContain('%% Shared Schema Tables');
  });

  it('should include indexes when requested', () => {
    const options: ExportOptions = {
      format: 'mermaid',
      mermaid: { includeIndexes: true },
    };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('%% Indexes:');
    expect(result).toContain('users_email_idx(unique)');
    expect(result).toContain('orders_user_id_idx');
  });

  it('should support theme configuration', () => {
    const options: ExportOptions = {
      format: 'mermaid',
      mermaid: { theme: 'dark' },
    };
    const result = exporter.export(mockTables, options);

    expect(result).toContain("%%{init: {'theme': 'dark'}}%%");
  });

  it('should mark nullable columns', () => {
    const options: ExportOptions = { format: 'mermaid' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('"nullable"');
  });
});

describe('SchemaExporter', () => {
  let exporter: SchemaExporter;

  beforeEach(() => {
    exporter = createSchemaExporter();
  });

  it('should export to JSON format', () => {
    const options: ExportOptions = {
      format: 'json',
      projectName: 'test-project',
    };

    const result = exporter.export(mockTables, options);
    const parsed = JSON.parse(result);

    expect(parsed.version).toBe('1.0.0');
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.projectName).toBe('test-project');
    expect(parsed.tables).toHaveLength(3);
  });

  it('should include metadata when requested', () => {
    const options: ExportOptions = {
      format: 'json',
      includeMetadata: true,
    };

    const result = exporter.export(mockTables, options);
    const parsed = JSON.parse(result);

    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata.tenantCount).toBe(2);
    expect(parsed.metadata.sharedCount).toBe(1);
    expect(parsed.metadata.totalColumns).toBe(12);
    expect(parsed.metadata.totalIndexes).toBe(2);
    expect(parsed.metadata.totalRelations).toBe(1);
  });

  it('should export to TypeScript format', () => {
    const options: ExportOptions = { format: 'typescript' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('export interface');
    expect(result).toContain('Tenant Schema Types');
  });

  it('should export to Mermaid format', () => {
    const options: ExportOptions = { format: 'mermaid' };
    const result = exporter.export(mockTables, options);

    expect(result).toContain('```mermaid');
    expect(result).toContain('erDiagram');
  });

  it('should export to JSON Schema format', () => {
    const options: ExportOptions = { format: 'json' };
    const result = exporter.exportToJsonSchema(mockTables, options);
    const parsed = JSON.parse(result);

    expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(parsed.definitions).toBeDefined();
  });

  it('should throw for unknown format', () => {
    const options = { format: 'unknown' as any };

    expect(() => exporter.export(mockTables, options)).toThrow('Unknown export format');
  });

  it('should return supported formats', () => {
    const formats = exporter.getSupportedFormats();

    expect(formats).toContain('json');
    expect(formats).toContain('typescript');
    expect(formats).toContain('mermaid');
    expect(formats).toHaveLength(3);
  });
});

describe('Data Type Mapping', () => {
  const exporter = createJsonSchemaExporter();

  const testCases = [
    // UUID
    { dataType: 'uuid', expectedType: 'string', expectedFormat: 'uuid' },
    // Text types
    { dataType: 'text', expectedType: 'string' },
    { dataType: 'varchar(255)', expectedType: 'string', expectedMaxLength: 255 },
    { dataType: 'char(10)', expectedType: 'string', expectedMaxLength: 10 },
    // Integer types
    { dataType: 'integer', expectedType: 'integer' },
    { dataType: 'int', expectedType: 'integer' },
    { dataType: 'smallint', expectedType: 'integer' },
    { dataType: 'bigint', expectedType: 'integer' },
    { dataType: 'serial', expectedType: 'integer' },
    { dataType: 'bigserial', expectedType: 'integer' },
    // Float types
    { dataType: 'real', expectedType: 'number' },
    { dataType: 'double precision', expectedType: 'number' },
    { dataType: 'numeric(10,2)', expectedType: 'number' },
    { dataType: 'decimal(8,4)', expectedType: 'number' },
    // Boolean
    { dataType: 'boolean', expectedType: 'boolean' },
    { dataType: 'bool', expectedType: 'boolean' },
    // Date/Time
    { dataType: 'date', expectedType: 'string', expectedFormat: 'date' },
    { dataType: 'timestamp', expectedType: 'string', expectedFormat: 'date-time' },
    { dataType: 'timestamp with time zone', expectedType: 'string', expectedFormat: 'date-time' },
    { dataType: 'time', expectedType: 'string', expectedFormat: 'time' },
    // JSON
    {
      dataType: 'json',
      expectedType: ['object', 'array', 'string', 'number', 'boolean', 'null'],
    },
    {
      dataType: 'jsonb',
      expectedType: ['object', 'array', 'string', 'number', 'boolean', 'null'],
    },
    // Binary
    { dataType: 'bytea', expectedType: 'string', expectedFormat: 'byte' },
  ];

  testCases.forEach(({ dataType, expectedType, expectedFormat, expectedMaxLength }) => {
    it(`should map ${dataType} correctly`, () => {
      const table: ExportedTable = {
        name: 'test',
        schemaType: 'tenant',
        columns: [
          {
            name: 'col',
            dataType,
            isPrimaryKey: false,
            isNullable: false,
            hasDefault: false,
          },
        ],
        indexes: [],
      };

      const result = exporter.export([table], { format: 'json' });
      const parsed = JSON.parse(result);
      const property = parsed.definitions.Test.properties.col;

      expect(property.type).toEqual(expectedType);

      if (expectedFormat) {
        expect(property.format).toBe(expectedFormat);
      }

      if (expectedMaxLength) {
        expect(property.maxLength).toBe(expectedMaxLength);
      }
    });
  });
});
