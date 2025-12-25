/**
 * Lint Reporter
 *
 * Formats and outputs lint results in various formats.
 */

import type { LintResult, LintIssue, ReporterOptions, ReporterFormat } from './types.js';

/**
 * Color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

/**
 * Apply color to text
 */
function colorize(text: string, color: keyof typeof colors, useColors: boolean): string {
  if (!useColors) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Format a single issue for console output
 */
function formatIssueConsole(issue: LintIssue, useColors: boolean): string {
  const severity =
    issue.severity === 'error'
      ? colorize('error', 'red', useColors)
      : colorize('warn', 'yellow', useColors);

  const location = issue.column
    ? `${issue.table}.${issue.column}`
    : issue.table ?? issue.filePath;

  const rule = colorize(`(${issue.rule})`, 'dim', useColors);

  let output = `  ${severity}  ${issue.message} ${rule}`;
  output += `\n         ${colorize(location, 'dim', useColors)}`;

  if (issue.suggestion) {
    output += `\n         ${colorize('→ ' + issue.suggestion, 'cyan', useColors)}`;
  }

  return output;
}

/**
 * Format results for console output
 */
function formatConsole(result: LintResult, options: ReporterOptions): string {
  const useColors = options.colors !== false;
  const lines: string[] = [];

  // Group issues by file
  for (const fileResult of result.files) {
    if (fileResult.issues.length === 0 && !options.verbose) continue;

    lines.push('');
    lines.push(colorize(fileResult.filePath, 'bold', useColors));

    if (fileResult.issues.length === 0) {
      lines.push(colorize('  No issues found', 'green', useColors));
      continue;
    }

    for (const issue of fileResult.issues) {
      lines.push(formatIssueConsole(issue, useColors));
    }
  }

  // Summary
  if (!options.quiet) {
    lines.push('');
    const { errors, warnings, totalTables } = result.summary;

    if (errors === 0 && warnings === 0) {
      lines.push(
        colorize(`✓ ${totalTables} tables validated, no issues found`, 'green', useColors)
      );
    } else {
      const parts: string[] = [];
      parts.push(`${totalTables} tables validated`);
      if (warnings > 0) {
        parts.push(colorize(`${warnings} warning${warnings > 1 ? 's' : ''}`, 'yellow', useColors));
      }
      if (errors > 0) {
        parts.push(colorize(`${errors} error${errors > 1 ? 's' : ''}`, 'red', useColors));
      }
      lines.push(parts.join(', '));
    }

    lines.push(colorize(`Completed in ${result.durationMs}ms`, 'dim', useColors));
  }

  return lines.join('\n');
}

/**
 * Format results for JSON output
 */
function formatJson(result: LintResult): string {
  return JSON.stringify(
    {
      passed: result.passed,
      summary: result.summary,
      files: result.files.map((file) => ({
        filePath: file.filePath,
        tables: file.tables,
        columns: file.columns,
        issues: file.issues,
      })),
      durationMs: result.durationMs,
    },
    null,
    2
  );
}

/**
 * Format results for GitHub Actions annotations
 *
 * Uses workflow commands to create annotations that appear in the PR/commit.
 * @see https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
 */
function formatGitHub(result: LintResult): string {
  const lines: string[] = [];

  for (const fileResult of result.files) {
    for (const issue of fileResult.issues) {
      const command = issue.severity === 'error' ? 'error' : 'warning';
      const title = `[${issue.rule}]`;
      const file = issue.filePath;
      const line = issue.line ?? 1;

      // GitHub Actions annotation format:
      // ::error file={name},line={line},title={title}::{message}
      let annotation = `::${command} file=${file},line=${line},title=${title}::${issue.message}`;

      if (issue.suggestion) {
        annotation += ` (${issue.suggestion})`;
      }

      lines.push(annotation);
    }
  }

  // Add summary as a notice
  const { errors, warnings, totalTables } = result.summary;
  if (errors > 0 || warnings > 0) {
    lines.push(
      `::notice::Schema lint: ${totalTables} tables, ${errors} errors, ${warnings} warnings`
    );
  } else {
    lines.push(`::notice::Schema lint: ${totalTables} tables validated, no issues`);
  }

  return lines.join('\n');
}

/**
 * Format lint results according to the specified format
 */
export function formatLintResult(result: LintResult, options: ReporterOptions): string {
  switch (options.format) {
    case 'json':
      return formatJson(result);
    case 'github':
      return formatGitHub(result);
    case 'console':
    default:
      return formatConsole(result, options);
  }
}

/**
 * Create a reporter function for the specified format
 */
export function createReporter(format: ReporterFormat, options?: Partial<ReporterOptions>) {
  const reporterOptions: ReporterOptions = {
    format,
    quiet: options?.quiet ?? false,
    verbose: options?.verbose ?? false,
    colors: options?.colors ?? true,
  };

  return (result: LintResult): string => formatLintResult(result, reporterOptions);
}

/**
 * Print lint result to stdout
 */
export function printLintResult(result: LintResult, options: ReporterOptions): void {
  const output = formatLintResult(result, options);
  console.log(output);
}
