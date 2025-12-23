import ora, { type Ora } from 'ora';
import chalk from 'chalk';

/**
 * Create a spinner instance
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: 'cyan',
  });
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
