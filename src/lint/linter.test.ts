import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaLinter, createLinter, parseRawTable } from './linter.js';
import type { SchemaTable, LintRules } from './types.js';

describe('SchemaLinter', () => {
  let linter: SchemaLinter;

  beforeEach(() => {
    linter = new SchemaLinter();
  });

  describe('constructor', () => {
    it('should use default rules when no options provided', () => {
      expect(linter.getEffectiveSeverity('require-primary-key')).toBe('error');
      expect(linter.getEffectiveSeverity('table-naming')).toBe('warn');
    });

    it('should merge provided rules with defaults', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'require-primary-key': 'warn',
          'require-timestamps': 'error',
        },
      });

      expect(customLinter.getEffectiveSeverity('require-primary-key')).toBe('warn');
      expect(customLinter.getEffectiveSeverity('require-timestamps')).toBe('error');
      expect(customLinter.getEffectiveSeverity('table-naming')).toBe('warn');
    });
  });

  describe('getEffectiveSeverity', () => {
    it('should return "off" for disabled rules', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'table-naming': 'off',
        },
      });

      expect(customLinter.getEffectiveSeverity('table-naming')).toBe('off');
    });

    it('should return severity from array config', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'table-naming': ['error', { style: 'camelCase' }],
        },
      });

      expect(customLinter.getEffectiveSeverity('table-naming')).toBe('error');
    });
  });

  describe('getRuleOptions', () => {
    it('should return empty object for string config', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'require-primary-key': 'error',
        },
      });

      expect(customLinter.getRuleOptions('require-primary-key')).toEqual({});
    });

    it('should return options from array config', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'table-naming': ['error', { style: 'camelCase' }],
        },
      });

      expect(customLinter.getRuleOptions('table-naming')).toEqual({ style: 'camelCase' });
    });
  });

  describe('isRuleEnabled', () => {
    it('should return true for enabled rules', () => {
      expect(linter.isRuleEnabled('require-primary-key')).toBe(true);
    });

    it('should return false for disabled rules', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'require-timestamps': 'off',
        },
      });

      expect(customLinter.isRuleEnabled('require-timestamps')).toBe(false);
    });
  });

  describe('lintTable', () => {
    it('should return empty array for valid table', () => {
      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'email', dataType: 'text' },
        ],
        { filePath: '/path/to/users.ts' }
      );

      const issues = linter.lintTable(table);
      // Table has PK and uses UUID, so should pass most rules
      expect(issues.filter((i) => i.rule === 'require-primary-key')).toHaveLength(0);
    });

    it('should report missing primary key', () => {
      const table = parseRawTable(
        'posts',
        [{ name: 'title', dataType: 'text' }],
        { filePath: '/path/to/posts.ts' }
      );

      const issues = linter.lintTable(table);
      const pkIssue = issues.find((i) => i.rule === 'require-primary-key');

      expect(pkIssue).toBeDefined();
      expect(pkIssue?.severity).toBe('error');
      expect(pkIssue?.message).toContain('posts');
    });

    it('should report non-UUID primary key as warning', () => {
      const table = parseRawTable(
        'posts',
        [{ name: 'id', dataType: 'serial', isPrimaryKey: true }],
        { filePath: '/path/to/posts.ts' }
      );

      const issues = linter.lintTable(table);
      const uuidIssue = issues.find((i) => i.rule === 'prefer-uuid-pk');

      expect(uuidIssue).toBeDefined();
      expect(uuidIssue?.severity).toBe('warn');
    });

    it('should not report UUID primary key', () => {
      const table = parseRawTable(
        'users',
        [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
        { filePath: '/path/to/users.ts' }
      );

      const issues = linter.lintTable(table);
      const uuidIssue = issues.find((i) => i.rule === 'prefer-uuid-pk');

      expect(uuidIssue).toBeUndefined();
    });
  });

  describe('lintTables', () => {
    it('should lint multiple tables', () => {
      const tables: SchemaTable[] = [
        parseRawTable(
          'users',
          [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
          { filePath: '/path/to/users.ts' }
        ),
        parseRawTable(
          'posts',
          [{ name: 'title', dataType: 'text' }], // Missing PK
          { filePath: '/path/to/posts.ts' }
        ),
      ];

      const result = linter.lintTables(tables);

      expect(result.summary.totalTables).toBe(2);
      expect(result.summary.errors).toBeGreaterThan(0);
      expect(result.passed).toBe(false);
    });

    it('should return passed=true when no errors', () => {
      const tables: SchemaTable[] = [
        parseRawTable(
          'users',
          [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
          { filePath: '/path/to/users.ts' }
        ),
      ];

      const result = linter.lintTables(tables);

      // Should pass (warnings don't fail)
      expect(result.passed).toBe(true);
    });

    it('should group issues by file', () => {
      const tables: SchemaTable[] = [
        parseRawTable('users', [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }], {
          filePath: '/path/to/users.ts',
        }),
        parseRawTable('posts', [{ name: 'title', dataType: 'text' }], {
          filePath: '/path/to/posts.ts',
        }),
      ];

      const result = linter.lintTables(tables);

      expect(result.files.length).toBe(2);
      expect(result.files[0].filePath).toBe('/path/to/users.ts');
      expect(result.files[1].filePath).toBe('/path/to/posts.ts');
    });
  });

  describe('naming rules', () => {
    it('should report non-snake_case table names', () => {
      const table = parseRawTable(
        'UserProfiles',
        [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
        { filePath: '/path/to/test.ts' }
      );

      const issues = linter.lintTable(table);
      const namingIssue = issues.find((i) => i.rule === 'table-naming');

      expect(namingIssue).toBeDefined();
      expect(namingIssue?.message).toContain('UserProfiles');
      expect(namingIssue?.suggestion).toContain('user_profiles');
    });

    it('should report non-snake_case column names', () => {
      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'firstName', dataType: 'text' },
        ],
        { filePath: '/path/to/test.ts' }
      );

      const issues = linter.lintTable(table);
      const namingIssue = issues.find((i) => i.rule === 'column-naming');

      expect(namingIssue).toBeDefined();
      expect(namingIssue?.message).toContain('firstName');
      expect(namingIssue?.suggestion).toContain('first_name');
    });

    it('should accept snake_case names', () => {
      const table = parseRawTable(
        'user_profiles',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'first_name', dataType: 'text' },
        ],
        { filePath: '/path/to/test.ts' }
      );

      const issues = linter.lintTable(table);
      const namingIssues = issues.filter(
        (i) => i.rule === 'table-naming' || i.rule === 'column-naming'
      );

      expect(namingIssues).toHaveLength(0);
    });

    it('should support camelCase naming style option', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'table-naming': ['warn', { style: 'camelCase' }],
          'column-naming': ['warn', { style: 'camelCase' }],
        },
      });

      const table = parseRawTable(
        'userProfiles',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'firstName', dataType: 'text' },
        ],
        { filePath: '/path/to/test.ts' }
      );

      const issues = customLinter.lintTable(table);
      const namingIssues = issues.filter(
        (i) => i.rule === 'table-naming' || i.rule === 'column-naming'
      );

      expect(namingIssues).toHaveLength(0);
    });
  });

  describe('foreign key rules', () => {
    it('should report missing index on foreign key', () => {
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
        { filePath: '/path/to/orders.ts' }
      );

      const issues = linter.lintTable(table);
      const fkIssue = issues.find((i) => i.rule === 'index-foreign-keys');

      expect(fkIssue).toBeDefined();
      expect(fkIssue?.message).toContain('user_id');
    });

    it('should not report when FK column is indexed', () => {
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
          filePath: '/path/to/orders.ts',
          indexes: [{ name: 'orders_user_id_idx', columns: ['user_id'] }],
        }
      );

      const issues = linter.lintTable(table);
      const fkIssue = issues.find((i) => i.rule === 'index-foreign-keys');

      expect(fkIssue).toBeUndefined();
    });
  });

  describe('security rules', () => {
    it('should report CASCADE DELETE when enabled', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'no-cascade-delete': 'warn',
        },
      });

      const table = parseRawTable(
        'orders',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          {
            name: 'user_id',
            dataType: 'uuid',
            references: { table: 'users', column: 'id', onDelete: 'CASCADE' },
          },
        ],
        { filePath: '/path/to/orders.ts' }
      );

      const issues = customLinter.lintTable(table);
      const cascadeIssue = issues.find((i) => i.rule === 'no-cascade-delete');

      expect(cascadeIssue).toBeDefined();
      expect(cascadeIssue?.message).toContain('CASCADE DELETE');
    });

    it('should report missing soft delete when enabled', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'require-soft-delete': 'warn',
        },
      });

      const table = parseRawTable(
        'users',
        [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
        { filePath: '/path/to/users.ts' }
      );

      const issues = customLinter.lintTable(table);
      const softDeleteIssue = issues.find((i) => i.rule === 'require-soft-delete');

      expect(softDeleteIssue).toBeDefined();
    });

    it('should not report soft delete when column exists', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'require-soft-delete': 'warn',
        },
      });

      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'deleted_at', dataType: 'timestamp' },
        ],
        { filePath: '/path/to/users.ts' }
      );

      const issues = customLinter.lintTable(table);
      const softDeleteIssue = issues.find((i) => i.rule === 'require-soft-delete');

      expect(softDeleteIssue).toBeUndefined();
    });
  });

  describe('timestamps rules', () => {
    it('should report missing timestamps when enabled', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'require-timestamps': 'warn',
        },
      });

      const table = parseRawTable(
        'users',
        [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
        { filePath: '/path/to/users.ts' }
      );

      const issues = customLinter.lintTable(table);
      const timestampIssues = issues.filter((i) => i.rule === 'require-timestamps');

      expect(timestampIssues.length).toBe(2); // created_at and updated_at
    });

    it('should not report when timestamps exist', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'require-timestamps': 'warn',
        },
      });

      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'created_at', dataType: 'timestamp' },
          { name: 'updated_at', dataType: 'timestamp' },
        ],
        { filePath: '/path/to/users.ts' }
      );

      const issues = customLinter.lintTable(table);
      const timestampIssues = issues.filter((i) => i.rule === 'require-timestamps');

      expect(timestampIssues).toHaveLength(0);
    });

    it('should support custom timestamp columns', () => {
      const customLinter = new SchemaLinter({
        rules: {
          'require-timestamps': ['warn', { columns: ['created_at'] }],
        },
      });

      const table = parseRawTable(
        'users',
        [
          { name: 'id', dataType: 'uuid', isPrimaryKey: true },
          { name: 'created_at', dataType: 'timestamp' },
        ],
        { filePath: '/path/to/users.ts' }
      );

      const issues = customLinter.lintTable(table);
      const timestampIssues = issues.filter((i) => i.rule === 'require-timestamps');

      expect(timestampIssues).toHaveLength(0);
    });
  });
});

describe('createLinter', () => {
  it('should create a linter with default options', () => {
    const linter = createLinter();
    expect(linter).toBeInstanceOf(SchemaLinter);
  });

  it('should create a linter with custom rules', () => {
    const rules: LintRules = {
      'require-primary-key': 'warn',
    };

    const linter = createLinter({ rules });
    expect(linter.getEffectiveSeverity('require-primary-key')).toBe('warn');
  });
});

describe('parseRawTable', () => {
  it('should create a table with defaults', () => {
    const table = parseRawTable('users', [
      { name: 'id', dataType: 'uuid', isPrimaryKey: true },
    ]);

    expect(table.name).toBe('users');
    expect(table.schemaType).toBe('tenant');
    expect(table.filePath).toBe('unknown');
    expect(table.columns).toHaveLength(1);
    expect(table.indexes).toHaveLength(0);
  });

  it('should create a table with custom options', () => {
    const table = parseRawTable(
      'plans',
      [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }],
      {
        schemaType: 'shared',
        filePath: '/path/to/plans.ts',
        indexes: [{ name: 'plans_name_idx', columns: ['name'], isUnique: true }],
      }
    );

    expect(table.schemaType).toBe('shared');
    expect(table.filePath).toBe('/path/to/plans.ts');
    expect(table.indexes).toHaveLength(1);
    expect(table.indexes[0].isUnique).toBe(true);
  });
});
