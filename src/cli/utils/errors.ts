import { error, dim, cyan, getOutputContext } from './output.js';

/**
 * CLI Error with actionable suggestions
 */
export class CLIError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string,
    public readonly example?: string,
    public readonly docs?: string
  ) {
    super(message);
    this.name = 'CLIError';
  }

  /**
   * Format the error for display
   */
  format(): string {
    const lines: string[] = [error(this.message)];

    if (this.suggestion) {
      lines.push('');
      lines.push(dim('  Suggestion: ') + this.suggestion);
    }

    if (this.example) {
      lines.push('');
      lines.push(dim('  Example:'));
      lines.push(cyan('    ' + this.example));
    }

    if (this.docs) {
      lines.push('');
      lines.push(dim('  Docs: ') + this.docs);
    }

    return lines.join('\n');
  }

  /**
   * Format as JSON for machine-readable output
   */
  toJSON(): object {
    return {
      error: this.message,
      suggestion: this.suggestion,
      example: this.example,
      docs: this.docs,
    };
  }
}

/**
 * Common CLI errors with pre-defined suggestions
 */
export const CLIErrors = {
  configNotFound: (searchPaths?: string[]) =>
    new CLIError(
      'Configuration file not found',
      'Create a tenant.config.ts file or use --config <path>',
      `export default defineConfig({
  connection: process.env.DATABASE_URL,
  isolation: { type: 'schema', schemaNameTemplate: (id) => \`tenant_\${id}\` },
  schemas: {
    tenant: { ... },
  },
})`,
      searchPaths ? `Searched: ${searchPaths.join(', ')}` : undefined
    ),

  noTenantDiscovery: () =>
    new CLIError(
      'No tenant discovery function configured',
      'Add a tenantDiscovery function to your config migrations settings',
      `migrations: {
  tenantDiscovery: async () => {
    const tenants = await db.select().from(tenantsTable);
    return tenants.map(t => t.id);
  },
}`
    ),

  noTenantSpecified: () =>
    new CLIError(
      'No tenant specified',
      'Use --all, --tenant <id>, or --tenants <ids> to specify which tenants to migrate',
      `npx drizzle-multitenant migrate --all
npx drizzle-multitenant migrate --tenant=my-tenant
npx drizzle-multitenant migrate --tenants=tenant-1,tenant-2`
    ),

  tenantNotFound: (tenantId: string) =>
    new CLIError(
      `Tenant '${tenantId}' not found`,
      'Check if the tenant exists in your database',
      'npx drizzle-multitenant status'
    ),

  migrationsFolderNotFound: (path: string) =>
    new CLIError(
      `Migrations folder not found: ${path}`,
      'Create the migrations folder or specify a different path with --migrations-folder',
      `mkdir -p ${path}
npx drizzle-multitenant generate --name initial`
    ),

  invalidFormat: (format: string, validFormats: string[]) =>
    new CLIError(
      `Invalid format: '${format}'`,
      `Valid formats are: ${validFormats.join(', ')}`,
      `npx drizzle-multitenant convert-format --to=${validFormats[0]}`
    ),

  connectionFailed: (reason: string) =>
    new CLIError(
      `Database connection failed: ${reason}`,
      'Check your DATABASE_URL and ensure the database is running',
      'export DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"'
    ),

  migrationFailed: (tenantId: string, reason: string) =>
    new CLIError(
      `Migration failed for tenant '${tenantId}': ${reason}`,
      'Check the migration SQL for syntax errors or constraint violations'
    ),

  sharedMigrationsNotConfigured: () =>
    new CLIError(
      'Shared migrations folder not configured',
      'Set sharedFolder in your config migrations settings or use --migrations-folder option',
      `migrations: {
  folder: './drizzle/tenant-migrations',
  sharedFolder: './drizzle/shared-migrations',
  tenantDiscovery: async () => [...],
}`
    ),

  /**
   * Create a custom CLI error
   */
  create: (message: string, suggestion?: string, example?: string, docs?: string) =>
    new CLIError(message, suggestion, example, docs),
};

/**
 * Handle an error and exit the process
 */
export function handleError(err: unknown): never {
  const ctx = getOutputContext();

  if (ctx.jsonMode) {
    if (err instanceof CLIError) {
      console.log(JSON.stringify(err.toJSON(), null, 2));
    } else {
      console.log(JSON.stringify({ error: (err as Error).message }, null, 2));
    }
    process.exit(1);
  }

  if (err instanceof CLIError) {
    console.error(err.format());
  } else {
    console.error(error((err as Error).message));
  }

  process.exit(1);
}

/**
 * Wrap a command action with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<void>>(
  fn: T
): T {
  return (async (...args: unknown[]) => {
    try {
      await fn(...args);
    } catch (err) {
      handleError(err);
    }
  }) as T;
}
