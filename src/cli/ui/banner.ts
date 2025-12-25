import chalk from 'chalk';

/**
 * CLI Banner with gradient effect
 */
export function showBanner(): void {
  const width = 43;
  const title = 'Drizzle Multitenant CLI';
  const subtitle = 'Multi-tenancy toolkit for Drizzle';

  const padTitle = Math.floor((width - title.length) / 2);
  const padSubtitle = Math.floor((width - subtitle.length) / 2);

  console.log('');
  console.log(chalk.cyan.bold('  ╔' + '═'.repeat(width) + '╗'));
  console.log(chalk.cyan.bold('  ║') + chalk.white.bold(' '.repeat(padTitle) + title + ' '.repeat(width - padTitle - title.length)) + chalk.cyan.bold('║'));
  console.log(chalk.cyan.bold('  ║') + chalk.dim(' '.repeat(padSubtitle) + subtitle + ' '.repeat(width - padSubtitle - subtitle.length)) + chalk.cyan.bold('║'));
  console.log(chalk.cyan.bold('  ╚' + '═'.repeat(width) + '╝'));
  console.log('');
}

/**
 * Show a section header
 */
export function showHeader(title: string): void {
  console.log('');
  console.log(chalk.cyan.bold(`  ${title}`));
  console.log(chalk.dim('  ' + '─'.repeat(title.length + 4)));
  console.log('');
}

/**
 * Show status message with icon
 */
export function showStatus(
  message: string,
  type: 'success' | 'warning' | 'error' | 'info' = 'info'
): void {
  const icons = {
    success: chalk.green('✓'),
    warning: chalk.yellow('⚠'),
    error: chalk.red('✗'),
    info: chalk.blue('ℹ'),
  };

  const colors = {
    success: chalk.green,
    warning: chalk.yellow,
    error: chalk.red,
    info: chalk.blue,
  };

  console.log(`\n  ${icons[type]} ${colors[type](message)}\n`);
}

/**
 * Clear the screen
 */
export function clearScreen(): void {
  console.clear();
}

/**
 * Format tenant status for display
 */
export function formatTenantStatus(status: 'ok' | 'behind' | 'error'): string {
  switch (status) {
    case 'ok':
      return chalk.green('● up to date');
    case 'behind':
      return chalk.yellow('● pending');
    case 'error':
      return chalk.red('● error');
  }
}

/**
 * Format pending count for display
 */
export function formatPendingCount(count: number): string {
  if (count === 0) {
    return chalk.dim('0');
  }
  return chalk.yellow(`${count} pending`);
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
