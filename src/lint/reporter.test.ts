import { describe, it, expect } from 'vitest';
import { formatLintResult, createReporter } from './reporter.js';
import type { LintResult } from './types.js';

describe('reporter', () => {
  const sampleResult: LintResult = {
    files: [
      {
        filePath: '/path/to/users.ts',
        tables: 1,
        columns: 3,
        issues: [
          {
            rule: 'require-primary-key',
            severity: 'error',
            message: 'Table "users" does not have a primary key',
            filePath: '/path/to/users.ts',
            table: 'users',
            suggestion: 'Add a primary key column',
          },
        ],
      },
      {
        filePath: '/path/to/posts.ts',
        tables: 1,
        columns: 2,
        issues: [
          {
            rule: 'prefer-uuid-pk',
            severity: 'warn',
            message: 'Table "posts" uses serial for primary key',
            filePath: '/path/to/posts.ts',
            table: 'posts',
            column: 'id',
          },
        ],
      },
    ],
    summary: {
      totalFiles: 2,
      totalTables: 2,
      totalColumns: 5,
      errors: 1,
      warnings: 1,
    },
    durationMs: 42,
    passed: false,
  };

  const passingResult: LintResult = {
    files: [
      {
        filePath: '/path/to/users.ts',
        tables: 1,
        columns: 3,
        issues: [],
      },
    ],
    summary: {
      totalFiles: 1,
      totalTables: 1,
      totalColumns: 3,
      errors: 0,
      warnings: 0,
    },
    durationMs: 10,
    passed: true,
  };

  describe('formatLintResult', () => {
    describe('console format', () => {
      it('should format issues with severity icons', () => {
        const output = formatLintResult(sampleResult, {
          format: 'console',
          colors: false,
        });

        expect(output).toContain('require-primary-key');
        expect(output).toContain('prefer-uuid-pk');
        expect(output).toContain('users');
        expect(output).toContain('posts');
      });

      it('should include file paths', () => {
        const output = formatLintResult(sampleResult, {
          format: 'console',
          colors: false,
        });

        expect(output).toContain('/path/to/users.ts');
        expect(output).toContain('/path/to/posts.ts');
      });

      it('should include suggestions', () => {
        const output = formatLintResult(sampleResult, {
          format: 'console',
          colors: false,
        });

        expect(output).toContain('Add a primary key column');
      });

      it('should show summary', () => {
        const output = formatLintResult(sampleResult, {
          format: 'console',
          colors: false,
        });

        expect(output).toContain('2 tables validated');
        expect(output).toContain('1 error');
        expect(output).toContain('1 warning');
      });

      it('should show success message when no issues', () => {
        const output = formatLintResult(passingResult, {
          format: 'console',
          colors: false,
        });

        expect(output).toContain('1 tables validated');
        expect(output).toContain('no issues found');
      });

      it('should skip summary in quiet mode', () => {
        const output = formatLintResult(sampleResult, {
          format: 'console',
          colors: false,
          quiet: true,
        });

        expect(output).not.toContain('validated');
      });
    });

    describe('json format', () => {
      it('should output valid JSON', () => {
        const output = formatLintResult(sampleResult, { format: 'json' });

        expect(() => JSON.parse(output)).not.toThrow();
      });

      it('should include all expected fields', () => {
        const output = formatLintResult(sampleResult, { format: 'json' });
        const parsed = JSON.parse(output);

        expect(parsed.passed).toBe(false);
        expect(parsed.summary.errors).toBe(1);
        expect(parsed.summary.warnings).toBe(1);
        expect(parsed.files).toHaveLength(2);
        expect(parsed.durationMs).toBe(42);
      });

      it('should include issue details', () => {
        const output = formatLintResult(sampleResult, { format: 'json' });
        const parsed = JSON.parse(output);

        const issue = parsed.files[0].issues[0];
        expect(issue.rule).toBe('require-primary-key');
        expect(issue.severity).toBe('error');
        expect(issue.table).toBe('users');
      });
    });

    describe('github format', () => {
      it('should output GitHub Actions annotations', () => {
        const output = formatLintResult(sampleResult, { format: 'github' });

        expect(output).toContain('::error file=');
        expect(output).toContain('::warning file=');
        expect(output).toContain('::notice::');
      });

      it('should format errors correctly', () => {
        const output = formatLintResult(sampleResult, { format: 'github' });

        expect(output).toContain('::error file=/path/to/users.ts');
        expect(output).toContain('title=[require-primary-key]');
      });

      it('should format warnings correctly', () => {
        const output = formatLintResult(sampleResult, { format: 'github' });

        expect(output).toContain('::warning file=/path/to/posts.ts');
        expect(output).toContain('title=[prefer-uuid-pk]');
      });

      it('should include summary notice', () => {
        const output = formatLintResult(sampleResult, { format: 'github' });

        expect(output).toContain('::notice::Schema lint: 2 tables');
      });

      it('should show success notice when no issues', () => {
        const output = formatLintResult(passingResult, { format: 'github' });

        expect(output).toContain('no issues');
      });
    });
  });

  describe('createReporter', () => {
    it('should create a console reporter', () => {
      const reporter = createReporter('console');
      const output = reporter(sampleResult);

      expect(output).toContain('require-primary-key');
    });

    it('should create a json reporter', () => {
      const reporter = createReporter('json');
      const output = reporter(sampleResult);

      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('should create a github reporter', () => {
      const reporter = createReporter('github');
      const output = reporter(sampleResult);

      expect(output).toContain('::error');
    });

    it('should accept additional options', () => {
      const reporter = createReporter('console', { quiet: true });
      const output = reporter(sampleResult);

      expect(output).not.toContain('validated');
    });
  });
});
