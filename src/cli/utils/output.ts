import ora, { type Ora } from 'ora';
import chalk from 'chalk';

/**
 * Output context for CLI commands
 * Controls TTY detection, JSON mode, verbosity, and colors
 */
export interface OutputContext {
  /** Whether stdout is a TTY (interactive terminal) */
  isInteractive: boolean;
  /** Output as JSON instead of human-readable format */
  jsonMode: boolean;
  /** Show verbose/debug output */
  verbose: boolean;
  /** Only show errors (quiet mode) */
  quiet: boolean;
  /** Disable colors in output */
  noColor: boolean;
}

// Global output context - initialized with defaults
let globalContext: OutputContext = {
  isInteractive: process.stdout.isTTY ?? false,
  jsonMode: false,
  verbose: false,
  quiet: false,
  noColor: false,
};

/**
 * Initialize the output context from CLI options
 */
export function initOutputContext(options: {
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}): void {
  globalContext = {
    isInteractive: process.stdout.isTTY ?? false,
    jsonMode: options.json ?? false,
    verbose: options.verbose ?? false,
    quiet: options.quiet ?? false,
    noColor: options.noColor ?? !process.stdout.isTTY,
  };

  // Disable chalk colors if noColor is set
  if (globalContext.noColor) {
    chalk.level = 0;
  }
}

/**
 * Get the current output context
 */
export function getOutputContext(): OutputContext {
  return globalContext;
}

/**
 * Check if we should show interactive elements (spinners, progress bars)
 */
export function shouldShowInteractive(): boolean {
  return globalContext.isInteractive && !globalContext.jsonMode && !globalContext.quiet;
}

/**
 * Check if we should show regular log output
 */
export function shouldShowLog(): boolean {
  return !globalContext.jsonMode && !globalContext.quiet;
}

/**
 * Check if we should show verbose/debug output
 */
export function shouldShowVerbose(): boolean {
  return globalContext.verbose && !globalContext.jsonMode;
}

/**
 * Create a spinner that respects output context
 * Returns a no-op spinner if not in interactive mode
 */
export function createContextSpinner(text: string): Ora {
  if (!shouldShowInteractive()) {
    // Return a no-op spinner
    return {
      start: () => noopSpinner,
      stop: () => noopSpinner,
      succeed: () => noopSpinner,
      fail: () => noopSpinner,
      warn: () => noopSpinner,
      info: () => noopSpinner,
      isSpinning: false,
      text: '',
      color: 'cyan',
    } as unknown as Ora;
  }

  return ora({
    text,
    color: 'cyan',
  });
}

const noopSpinner = {
  start: () => noopSpinner,
  stop: () => noopSpinner,
  succeed: () => noopSpinner,
  fail: () => noopSpinner,
  warn: () => noopSpinner,
  info: () => noopSpinner,
  isSpinning: false,
  text: '',
  color: 'cyan',
};

/**
 * Log a message if not in quiet/json mode
 */
export function log(message: string): void {
  if (shouldShowLog()) {
    console.log(message);
  }
}

/**
 * Log a verbose/debug message
 */
export function debug(message: string): void {
  if (shouldShowVerbose()) {
    console.log(chalk.dim(`[debug] ${message}`));
  }
}

/**
 * Log an error message (always shown unless JSON mode)
 */
export function logError(message: string): void {
  if (!globalContext.jsonMode) {
    console.error(chalk.red('✗ ') + message);
  }
}

/**
 * Output JSON data (only in JSON mode)
 */
export function outputJson<T>(data: T): void {
  if (globalContext.jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Format success message
 */
export function success(message: string): string {
  return chalk.green('✓ ') + message;
}

/**
 * Format error message
 */
export function error(message: string): string {
  return chalk.red('✗ ') + message;
}

/**
 * Format warning message
 */
export function warning(message: string): string {
  return chalk.yellow('⚠ ') + message;
}

/**
 * Format info message
 */
export function info(message: string): string {
  return chalk.blue('ℹ ') + message;
}

/**
 * Format dim text
 */
export function dim(message: string): string {
  return chalk.dim(message);
}

/**
 * Format bold text
 */
export function bold(message: string): string {
  return chalk.bold(message);
}

/**
 * Format cyan text
 */
export function cyan(message: string): string {
  return chalk.cyan(message);
}

/**
 * Format green text
 */
export function green(message: string): string {
  return chalk.green(message);
}

/**
 * Format red text
 */
export function red(message: string): string {
  return chalk.red(message);
}

/**
 * Format yellow text
 */
export function yellow(message: string): string {
  return chalk.yellow(message);
}

/**
 * Format magenta text
 */
export function magenta(message: string): string {
  return chalk.magenta(message);
}
