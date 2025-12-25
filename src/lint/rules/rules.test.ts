import { describe, it, expect } from 'vitest';
import { parseRawTable } from '../linter.js';
import {
  tableNamingRule,
  columnNamingRule,
  requirePrimaryKeyRule,
  preferUuidPkRule,
  requireTimestampsRule,
  indexForeignKeysRule,
  noCascadeDeleteRule,
  requireSoftDeleteRule,
} from './index.js';
import type { RuleContext, LintIssue, SchemaColumn, SchemaTable } from '../types.js';

function createContext(
  severity: 'warn' | 'error' = 'warn',
  options: Record<string, unknown> = {}
): { context: RuleContext; issues: LintIssue[] } {
  const issues: LintIssue[] = [];
  const context: RuleContext = {
    severity,
    options,
    report: (issue) => {
      issues.push({
        rule: 'test-rule',
        severity,
        ...issue,
      });
    },
  };
  return { context, issues };
}

describe('naming rules', () => {
  describe('tableNamingRule', () => {
    it('should accept snake_case table names', () => {
      const table = parseRawTable('user_profiles', [], { filePath: 'test.ts' });
      const { context, issues } = createContext();

      tableNamingRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should reject PascalCase table names', () => {
      const table = parseRawTable('UserProfiles', [], { filePath: 'test.ts' });
      const { context, issues } = createContext();

      tableNamingRule.validateTable!(table, context);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('UserProfiles');
      expect(issues[0].suggestion).toContain('user_profiles');
    });

    it('should reject camelCase table names', () => {
      const table = parseRawTable('userProfiles', [], { filePath: 'test.ts' });
      const { context, issues } = createContext();

      tableNamingRule.validateTable!(table, context);

      expect(issues).toHaveLength(1);
    });

    it('should support camelCase style option', () => {
      const table = parseRawTable('userProfiles', [], { filePath: 'test.ts' });
      const { context, issues } = createContext('warn', { style: 'camelCase' });

      tableNamingRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should support PascalCase style option', () => {
      const table = parseRawTable('UserProfiles', [], { filePath: 'test.ts' });
      const { context, issues } = createContext('warn', { style: 'PascalCase' });

      tableNamingRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should support exceptions', () => {
      const table = parseRawTable('__migrations', [], { filePath: 'test.ts' });
      const { context, issues } = createContext('warn', { exceptions: ['__*'] });

      tableNamingRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });
  });

  describe('columnNamingRule', () => {
    it('should accept snake_case column names', () => {
      const table = parseRawTable('users', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
        name: 'first_name',
        dataType: 'text',
        isPrimaryKey: false,
        isNullable: true,
        hasDefault: false,
      };
      const { context, issues } = createContext();

      columnNamingRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(0);
    });

    it('should reject camelCase column names with snake_case style', () => {
      const table = parseRawTable('users', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
        name: 'firstName',
        dataType: 'text',
        isPrimaryKey: false,
        isNullable: true,
        hasDefault: false,
      };
      const { context, issues } = createContext();

      columnNamingRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('firstName');
      expect(issues[0].suggestion).toContain('first_name');
    });
  });
});

describe('convention rules', () => {
  describe('requirePrimaryKeyRule', () => {
    it('should pass when table has primary key', () => {
      const table = parseRawTable(
        'users',
        [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext('error');

      requirePrimaryKeyRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should fail when table has no primary key', () => {
      const table = parseRawTable(
        'users',
        [{ name: 'email', dataType: 'text' }],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext('error');

      requirePrimaryKeyRule.validateTable!(table, context);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('primary key');
    });
  });

  describe('preferUuidPkRule', () => {
    it('should pass when using uuid primary key', () => {
      const table = parseRawTable('users', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
        name: 'id',
        dataType: 'uuid',
        isPrimaryKey: true,
        isNullable: false,
        hasDefault: true,
      };
      const { context, issues } = createContext();

      preferUuidPkRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(0);
    });

    it('should warn when using serial primary key', () => {
      const table = parseRawTable('users', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
        name: 'id',
        dataType: 'serial',
        isPrimaryKey: true,
        isNullable: false,
        hasDefault: true,
      };
      const { context, issues } = createContext();

      preferUuidPkRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('serial');
    });

    it('should warn when using bigserial primary key', () => {
      const table = parseRawTable('users', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
        name: 'id',
        dataType: 'bigserial',
        isPrimaryKey: true,
        isNullable: false,
        hasDefault: true,
      };
      const { context, issues } = createContext();

      preferUuidPkRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(1);
    });

    it('should not check non-primary key columns', () => {
      const table = parseRawTable('users', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
        name: 'legacy_id',
        dataType: 'integer',
        isPrimaryKey: false,
        isNullable: true,
        hasDefault: false,
      };
      const { context, issues } = createContext();

      preferUuidPkRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(0);
    });
  });

  describe('requireTimestampsRule', () => {
    it('should fail when timestamps are missing', () => {
      const table = parseRawTable(
        'users',
        [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext();

      requireTimestampsRule.validateTable!(table, context);

      expect(issues).toHaveLength(2);
      expect(issues.some((i) => i.message.includes('created_at'))).toBe(true);
      expect(issues.some((i) => i.message.includes('updated_at'))).toBe(true);
    });

    it('should pass when timestamps exist', () => {
      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'created_at', dataType: 'timestamp' },
          { name: 'updated_at', dataType: 'timestamp' },
        ],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext();

      requireTimestampsRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should support custom timestamp columns', () => {
      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'created_at', dataType: 'timestamp' },
        ],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext('warn', { columns: ['created_at'] });

      requireTimestampsRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should accept camelCase timestamp names', () => {
      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'createdAt', dataType: 'timestamp' },
          { name: 'updatedAt', dataType: 'timestamp' },
        ],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext();

      requireTimestampsRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });
  });

  describe('indexForeignKeysRule', () => {
    it('should warn when FK column has no index', () => {
      const table = parseRawTable(
        'orders',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          {
            name: 'user_id',
            dataType: 'uuid',
            references: { table: 'users', column: 'id' },
          },
        ],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext();

      indexForeignKeysRule.validateTable!(table, context);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('user_id');
    });

    it('should pass when FK column is indexed', () => {
      const table = parseRawTable(
        'orders',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          {
            name: 'user_id',
            dataType: 'uuid',
            references: { table: 'users', column: 'id' },
          },
        ],
        {
          filePath: 'test.ts',
          indexes: [{ name: 'idx_user_id', columns: ['user_id'] }],
        }
      );
      const { context, issues } = createContext();

      indexForeignKeysRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should not warn for columns without references', () => {
      const table = parseRawTable(
        'orders',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'user_id', dataType: 'uuid' }, // No reference
        ],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext();

      indexForeignKeysRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });
  });
});

describe('security rules', () => {
  describe('noCascadeDeleteRule', () => {
    it('should warn when FK uses CASCADE DELETE', () => {
      const table = parseRawTable('orders', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
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
      };
      const { context, issues } = createContext();

      noCascadeDeleteRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('CASCADE DELETE');
    });

    it('should not warn for SET NULL', () => {
      const table = parseRawTable('orders', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
        name: 'user_id',
        dataType: 'uuid',
        isPrimaryKey: false,
        isNullable: true,
        hasDefault: false,
        references: {
          table: 'users',
          column: 'id',
          onDelete: 'SET NULL',
        },
      };
      const { context, issues } = createContext();

      noCascadeDeleteRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(0);
    });

    it('should not warn for RESTRICT', () => {
      const table = parseRawTable('orders', [], { filePath: 'test.ts' });
      const column: SchemaColumn = {
        name: 'user_id',
        dataType: 'uuid',
        isPrimaryKey: false,
        isNullable: false,
        hasDefault: false,
        references: {
          table: 'users',
          column: 'id',
          onDelete: 'RESTRICT',
        },
      };
      const { context, issues } = createContext();

      noCascadeDeleteRule.validateColumn!(column, table, context);

      expect(issues).toHaveLength(0);
    });
  });

  describe('requireSoftDeleteRule', () => {
    it('should warn when soft delete column is missing', () => {
      const table = parseRawTable(
        'users',
        [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext();

      requireSoftDeleteRule.validateTable!(table, context);

      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('deleted_at');
    });

    it('should pass when soft delete column exists', () => {
      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'deleted_at', dataType: 'timestamp' },
        ],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext();

      requireSoftDeleteRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should support custom soft delete column name', () => {
      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'archived_at', dataType: 'timestamp' },
        ],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext('warn', { column: 'archived_at' });

      requireSoftDeleteRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });

    it('should accept camelCase soft delete column', () => {
      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'deletedAt', dataType: 'timestamp' },
        ],
        { filePath: 'test.ts' }
      );
      const { context, issues } = createContext();

      requireSoftDeleteRule.validateTable!(table, context);

      expect(issues).toHaveLength(0);
    });
  });
});
