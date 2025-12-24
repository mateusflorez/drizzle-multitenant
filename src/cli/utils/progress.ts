import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { shouldShowInteractive, dim, green, red } from './output.js';

export interface ProgressBarOptions {
  /** Total number of items to process */
  total: number;
  /** Format string for the progress bar */
  format?: string;
  /** Show ETA (estimated time remaining) */
  showEta?: boolean;
}

export interface ProgressBar {
  /** Start the progress bar */
  start(): void;
  /** Update progress with current item info */
  update(current: number, payload?: { tenant?: string; status?: 'success' | 'error' }): void;
  /** Increment progress by 1 */
  increment(payload?: { tenant?: string; status?: 'success' | 'error' }): void;
  /** Stop the progress bar */
  stop(): void;
}

/**
 * Create a progress bar for tenant migrations
 * Returns a no-op progress bar if not in interactive mode
 */
export function createProgressBar(options: ProgressBarOptions): ProgressBar {
  const { total } = options;

  if (!shouldShowInteractive()) {
    // Return a no-op progress bar
    return {
      start: () => {},
      update: () => {},
      increment: () => {},
      stop: () => {},
    };
  }

  const format =
    options.format ||
    `${chalk.cyan('Migrating')} ${chalk.cyan('{bar}')} ${chalk.yellow('{percentage}%')} | {value}/{total} | {tenant} | ${dim('{eta}s')}`;

  const bar = new cliProgress.SingleBar(
    {
      format,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
      etaBuffer: 10,
    },
    cliProgress.Presets.shades_classic
  );

  let currentValue = 0;

  return {
    start() {
      bar.start(total, 0, { tenant: 'starting...', status: '' });
    },

    update(current: number, payload?: { tenant?: string; status?: 'success' | 'error' }) {
      currentValue = current;
      const statusIcon = payload?.status === 'success' ? green('✓') : payload?.status === 'error' ? red('✗') : '';
      bar.update(current, {
        tenant: payload?.tenant ? `${statusIcon} ${payload.tenant}` : '',
      });
    },

    increment(payload?: { tenant?: string; status?: 'success' | 'error' }) {
      currentValue++;
      const statusIcon = payload?.status === 'success' ? green('✓') : payload?.status === 'error' ? red('✗') : '';
      bar.update(currentValue, {
        tenant: payload?.tenant ? `${statusIcon} ${payload.tenant}` : '',
      });
    },

    stop() {
      bar.stop();
    },
  };
}

/**
 * Create a multi-bar for concurrent operations
 */
export function createMultiProgressBar(): {
  create(total: number, startValue: number, payload?: Record<string, unknown>): cliProgress.SingleBar;
  stop(): void;
} {
  if (!shouldShowInteractive()) {
    return {
      create: () => ({
        start: () => {},
        update: () => {},
        increment: () => {},
        stop: () => {},
      } as unknown as cliProgress.SingleBar),
      stop: () => {},
    };
  }

  const multibar = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: `${chalk.cyan('{bar}')} | {tenant} | {status}`,
    },
    cliProgress.Presets.shades_grey
  );

  return {
    create(total: number, startValue: number, payload?: Record<string, unknown>) {
      return multibar.create(total, startValue, payload);
    },
    stop() {
      multibar.stop();
    },
  };
}
