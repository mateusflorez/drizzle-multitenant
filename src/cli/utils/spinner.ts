import ora, { type Ora } from 'ora';

/**
 * Create a spinner instance
 * @deprecated Use createContextSpinner from output.ts for TTY-aware spinners
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: 'cyan',
  });
}
