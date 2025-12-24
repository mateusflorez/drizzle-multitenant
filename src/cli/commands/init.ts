import { Command } from 'commander';
import { select, input, confirm } from '@inquirer/prompts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  log,
  success,
  info,
  warning,
  bold,
  dim,
  cyan,
  handleError,
  shouldShowInteractive,
} from '../utils/index.js';

export const initCommand = new Command('init')
  .description('Initialize a new drizzle-multitenant configuration')
  .option('--force', 'Overwrite existing configuration')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant init
  $ drizzle-multitenant init --force
`)
  .action(async (options: { force?: boolean }) => {
    try {
      if (!shouldShowInteractive()) {
        log(warning('Interactive mode required. Please run in a terminal.'));
        process.exit(1);
      }

      log(bold('\n🚀 drizzle-multitenant Setup Wizard\n'));

      // Check if config already exists
      const configFiles = [
        'tenant.config.ts',
        'tenant.config.js',
        'drizzle-multitenant.config.ts',
        'drizzle-multitenant.config.js',
      ];

      const existingConfig = configFiles.find(f => existsSync(join(process.cwd(), f)));

      if (existingConfig && !options.force) {
        log(warning(`Configuration file already exists: ${existingConfig}`));
        const overwrite = await confirm({
          message: 'Do you want to overwrite it?',
          default: false,
        });

        if (!overwrite) {
          log(info('Setup cancelled.'));
          return;
        }
      }

      // Ask for isolation type
      const isolationType = await select({
        message: 'Which isolation strategy do you want to use?',
        choices: [
          {
            name: 'Schema-based isolation (recommended)',
            value: 'schema',
            description: 'Each tenant has its own PostgreSQL schema',
          },
          {
            name: 'Row-level security (RLS)',
            value: 'rls',
            description: 'Shared tables with tenant_id column and RLS policies',
          },
        ],
      });

      // Ask for database URL variable
      const dbEnvVar = await input({
        message: 'Environment variable for database connection:',
        default: 'DATABASE_URL',
      });

      // Ask for migrations folder
      const migrationsFolder = await input({
        message: 'Migrations folder path:',
        default: './drizzle/tenant-migrations',
      });

      // Ask for schema name template (only for schema isolation)
      let schemaTemplate = 'tenant_${id}';
      if (isolationType === 'schema') {
        schemaTemplate = await input({
          message: 'Schema name template (use ${id} for tenant ID):',
          default: 'tenant_${id}',
        });
      }

      // Ask about TypeScript
      const useTypeScript = await confirm({
        message: 'Use TypeScript for configuration?',
        default: true,
      });

      // Generate config content
      const configContent = generateConfigContent({
        isolationType: isolationType as 'schema' | 'rls',
        dbEnvVar,
        migrationsFolder,
        schemaTemplate,
        useTypeScript,
      });

      // Write config file
      const configFileName = useTypeScript ? 'tenant.config.ts' : 'tenant.config.js';
      const configPath = join(process.cwd(), configFileName);
      writeFileSync(configPath, configContent);
      log(success(`Created ${configFileName}`));

      // Create migrations folder
      const fullMigrationsPath = join(process.cwd(), migrationsFolder);
      if (!existsSync(fullMigrationsPath)) {
        mkdirSync(fullMigrationsPath, { recursive: true });
        log(success(`Created migrations folder: ${migrationsFolder}`));
      }

      // Create .gitkeep in migrations folder
      const gitkeepPath = join(fullMigrationsPath, '.gitkeep');
      if (!existsSync(gitkeepPath)) {
        writeFileSync(gitkeepPath, '');
      }

      // Final instructions
      log('\n' + bold('✨ Setup complete!\n'));
      log('Next steps:\n');
      log(dim('1. Update your schema definitions in the config file'));
      log(dim('2. Set up tenant discovery function'));
      log(dim('3. Generate your first migration:'));
      log(cyan(`   npx drizzle-multitenant generate --name initial`));
      log(dim('4. Create a tenant:'));
      log(cyan(`   npx drizzle-multitenant tenant:create --id my-first-tenant`));
      log(dim('5. Check status:'));
      log(cyan(`   npx drizzle-multitenant status`));
      log('');
    } catch (err) {
      handleError(err);
    }
  });

interface ConfigOptions {
  isolationType: 'schema' | 'rls';
  dbEnvVar: string;
  migrationsFolder: string;
  schemaTemplate: string;
  useTypeScript: boolean;
}

function generateConfigContent(options: ConfigOptions): string {
  const { isolationType, dbEnvVar, migrationsFolder, schemaTemplate, useTypeScript } = options;

  if (useTypeScript) {
    return `import { defineConfig } from 'drizzle-multitenant';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Example tenant schema - customize this for your needs
const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export default defineConfig({
  // Database connection
  connection: process.env.${dbEnvVar}!,

  // Isolation strategy
  isolation: {
    type: '${isolationType}',
    ${isolationType === 'schema' ? `schemaNameTemplate: (id) => \`${schemaTemplate.replace('${id}', '${id}')}\`,` : ''}
  },

  // Schema definitions
  schemas: {
    tenant: {
      users,
      // Add more tables here...
    },
  },

  // Migration settings
  migrations: {
    folder: '${migrationsFolder}',
    table: '__drizzle_migrations',

    // Tenant discovery function - customize this!
    // This should return an array of tenant IDs from your database
    tenantDiscovery: async () => {
      // Example: Query your tenants table
      // const tenants = await db.select().from(tenantsTable);
      // return tenants.map(t => t.id);

      // For now, return empty array - update this!
      console.warn('⚠️  tenantDiscovery not configured - returning empty array');
      return [];
    },
  },
});
`;
  }

  // JavaScript version
  return `// @ts-check
const { defineConfig } = require('drizzle-multitenant');
const { pgTable, text, timestamp, uuid } = require('drizzle-orm/pg-core');

// Example tenant schema - customize this for your needs
const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

module.exports = defineConfig({
  // Database connection
  connection: process.env.${dbEnvVar},

  // Isolation strategy
  isolation: {
    type: '${isolationType}',
    ${isolationType === 'schema' ? `schemaNameTemplate: (id) => \`${schemaTemplate.replace('${id}', '${id}')}\`,` : ''}
  },

  // Schema definitions
  schemas: {
    tenant: {
      users,
      // Add more tables here...
    },
  },

  // Migration settings
  migrations: {
    folder: '${migrationsFolder}',
    table: '__drizzle_migrations',

    // Tenant discovery function - customize this!
    tenantDiscovery: async () => {
      // Example: Query your tenants table
      // For now, return empty array - update this!
      console.warn('⚠️  tenantDiscovery not configured - returning empty array');
      return [];
    },
  },
});
`;
}
