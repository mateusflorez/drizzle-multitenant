import { warning, dim } from './output.js';

/**
 * Validate tenant ID format
 * Returns null if valid, error message if invalid
 */
export function validateTenantId(tenantId: string): string | null {
  if (!tenantId || tenantId.trim().length === 0) {
    return 'Tenant ID cannot be empty';
  }

  // Must start with a letter or underscore
  if (!/^[a-zA-Z_]/.test(tenantId)) {
    return 'Tenant ID must start with a letter or underscore';
  }

  // Only alphanumeric, underscores, and hyphens allowed
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(tenantId)) {
    return 'Tenant ID can only contain letters, numbers, underscores, and hyphens';
  }

  // Max length for PostgreSQL identifier
  if (tenantId.length > 63) {
    return 'Tenant ID must be 63 characters or less';
  }

  return null;
}

/**
 * Find similar strings using Levenshtein distance
 */
export function findSimilar(input: string, candidates: string[], maxDistance = 3): string[] {
  return candidates
    .map(candidate => ({
      candidate,
      distance: levenshteinDistance(input.toLowerCase(), candidate.toLowerCase()),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map(({ candidate }) => candidate);
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  const firstRow = matrix[0];
  if (!firstRow) return 0;

  for (let j = 0; j <= a.length; j++) {
    firstRow[j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    const currentRow = matrix[i];
    const prevRow = matrix[i - 1];
    if (!currentRow || !prevRow) continue;

    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        currentRow[j] = prevRow[j - 1] ?? 0;
      } else {
        currentRow[j] = Math.min(
          (prevRow[j - 1] ?? 0) + 1, // substitution
          (currentRow[j - 1] ?? 0) + 1, // insertion
          (prevRow[j] ?? 0) + 1 // deletion
        );
      }
    }
  }

  const lastRow = matrix[b.length];
  return lastRow?.[a.length] ?? 0;
}

/**
 * Suggest corrections for a tenant ID that wasn't found
 */
export function suggestTenantCorrection(
  tenantId: string,
  availableTenants: string[]
): string | null {
  const similar = findSimilar(tenantId, availableTenants, 2);

  if (similar.length > 0) {
    return `Did you mean: ${similar.slice(0, 3).join(', ')}?`;
  }

  return null;
}

/**
 * Validate that a file path exists and is readable
 */
export function validateFilePath(path: string, type: 'file' | 'directory' = 'file'): string | null {
  try {
    const fs = require('node:fs');
    const stats = fs.statSync(path);

    if (type === 'file' && !stats.isFile()) {
      return `${path} is not a file`;
    }

    if (type === 'directory' && !stats.isDirectory()) {
      return `${path} is not a directory`;
    }

    return null;
  } catch {
    return `${path} does not exist`;
  }
}

/**
 * Validate concurrency value
 */
export function validateConcurrency(value: string): number {
  const num = parseInt(value, 10);

  if (isNaN(num) || num < 1) {
    console.log(warning(`Invalid concurrency value '${value}', using default of 10`));
    return 10;
  }

  if (num > 100) {
    console.log(warning(`Concurrency value ${num} is high, this may cause connection issues`));
  }

  return num;
}

/**
 * Validate migration name
 */
export function validateMigrationName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Migration name cannot be empty';
  }

  // Only alphanumeric, underscores, and hyphens
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    return 'Migration name must start with a letter and contain only letters, numbers, underscores, and hyphens';
  }

  if (name.length > 100) {
    return 'Migration name must be 100 characters or less';
  }

  return null;
}

/**
 * Format validation error with suggestions
 */
export function formatValidationError(error: string, suggestions?: string[]): string {
  let message = error;

  if (suggestions && suggestions.length > 0) {
    message += '\n\n' + dim('Suggestions:');
    for (const suggestion of suggestions) {
      message += '\n  ' + dim(`- ${suggestion}`);
    }
  }

  return message;
}
