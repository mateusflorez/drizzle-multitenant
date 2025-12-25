/**
 * Configuration file generator for tenant.config.ts
 */

import type { GeneratedFile, InitWizardAnswers } from '../types.js';

export function generateConfigFile(answers: InitWizardAnswers): GeneratedFile {
  const content = answers.useTypeScript
    ? generateTypeScriptConfig(answers)
    : generateJavaScriptConfig(answers);

  return {
    path: answers.useTypeScript ? 'tenant.config.ts' : 'tenant.config.js',
    content,
  };
}

function generateTypeScriptConfig(answers: InitWizardAnswers): string {
  const imports = generateImports(answers);
  const schemaImports = generateSchemaImports(answers);
  const configBody = generateConfigBody(answers);

  return `${imports}
${schemaImports}

export default defineConfig({
${configBody}
});
`;
}

function generateJavaScriptConfig(answers: InitWizardAnswers): string {
  const imports = generateJsImports(answers);
  const schemaImports = generateJsSchemaImports(answers);
  const configBody = generateConfigBody(answers);

  return `// @ts-check
${imports}
${schemaImports}

module.exports = defineConfig({
${configBody}
});
`;
}

function generateImports(answers: InitWizardAnswers): string {
  const imports = ["import { defineConfig } from 'drizzle-multitenant';"];

  if (answers.template === 'minimal') {
    imports.push("import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';");
  }

  return imports.join('\n');
}

function generateJsImports(answers: InitWizardAnswers): string {
  const imports = ["const { defineConfig } = require('drizzle-multitenant');"];

  if (answers.template === 'minimal') {
    imports.push("const { pgTable, text, timestamp, uuid } = require('drizzle-orm/pg-core');");
  }

  return imports.join('\n');
}

function generateSchemaImports(answers: InitWizardAnswers): string {
  if (answers.template === 'minimal') {
    return `
// Example tenant schema - customize this for your needs
const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
`;
  }

  const imports: string[] = [];

  // Tenant schema import
  imports.push("import * as tenantSchema from './src/db/schema/tenant/index.js';");

  // Shared schema import if enabled
  if (answers.features.sharedSchema) {
    imports.push("import * as sharedSchema from './src/db/schema/shared/index.js';");
  }

  return imports.join('\n');
}

function generateJsSchemaImports(answers: InitWizardAnswers): string {
  if (answers.template === 'minimal') {
    return `
// Example tenant schema - customize this for your needs
const { pgTable, text, timestamp, uuid } = require('drizzle-orm/pg-core');
const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
`;
  }

  const imports: string[] = [];
  imports.push("const tenantSchema = require('./src/db/schema/tenant/index.js');");

  if (answers.features.sharedSchema) {
    imports.push("const sharedSchema = require('./src/db/schema/shared/index.js');");
  }

  return imports.join('\n');
}

function generateConfigBody(answers: InitWizardAnswers): string {
  const sections: string[] = [];

  // Connection section
  sections.push(generateConnectionSection(answers));

  // Isolation section
  sections.push(generateIsolationSection(answers));

  // Schemas section
  sections.push(generateSchemasSection(answers));

  // Migrations section
  sections.push(generateMigrationsSection(answers));

  // Pool section
  sections.push(generatePoolSection(answers));

  // Debug section (if enabled)
  if (answers.features.debug) {
    sections.push(generateDebugSection());
  }

  return sections.join('\n\n');
}

function generateConnectionSection(answers: InitWizardAnswers): string {
  if (answers.databaseSetup === 'existing-url' && answers.databaseUrl) {
    return `  // Database connection
  connection: process.env.${answers.dbEnvVar} || '${answers.databaseUrl}',`;
  }

  return `  // Database connection
  connection: process.env.${answers.dbEnvVar}!,`;
}

function generateIsolationSection(answers: InitWizardAnswers): string {
  if (answers.isolationType === 'rls') {
    return `  // Isolation strategy
  isolation: {
    type: 'rls',
  },`;
  }

  return `  // Isolation strategy
  isolation: {
    type: 'schema',
    schemaNameTemplate: (id) => \`${answers.schemaTemplate.replace('${id}', '${id}')}\`,
  },`;
}

function generateSchemasSection(answers: InitWizardAnswers): string {
  if (answers.template === 'minimal') {
    const baseSchema = `  // Schema definitions
  schemas: {
    tenant: {
      users,
      // Add more tables here...
    },`;

    if (answers.features.sharedSchema) {
      return `${baseSchema}
    // shared: {
    //   plans,
    //   // Add shared tables here...
    // },
  },`;
    }

    return `${baseSchema}
  },`;
  }

  // For standard, full, enterprise templates
  if (answers.features.sharedSchema) {
    return `  // Schema definitions
  schemas: {
    tenant: tenantSchema,
    shared: sharedSchema,
  },`;
  }

  return `  // Schema definitions
  schemas: {
    tenant: tenantSchema,
  },`;
}

function generateMigrationsSection(answers: InitWizardAnswers): string {
  let section = `  // Migration settings
  migrations: {
    folder: '${answers.migrationsFolder}',
    table: '__drizzle_migrations',`;

  if (answers.features.sharedSchema) {
    section += `
    sharedFolder: '${answers.sharedMigrationsFolder}',
    sharedTable: '__drizzle_shared_migrations',`;
  }

  section += `

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
  },`;

  return section;
}

function generatePoolSection(answers: InitWizardAnswers): string {
  let section = `  // Pool configuration
  pool: {
    maxPools: 50,
    poolTtlMs: 3600000, // 1 hour`;

  if (answers.features.healthChecks) {
    section += `

    // Health check hooks
    hooks: {
      onPoolCreated: (tenantId) => {
        console.log(\`Pool created for tenant: \${tenantId}\`);
      },
      onPoolEvicted: (tenantId) => {
        console.log(\`Pool evicted for tenant: \${tenantId}\`);
      },
      onError: (tenantId, error) => {
        console.error(\`Pool error for tenant \${tenantId}:\`, error.message);
      },
    },`;
  }

  section += `
  },`;

  return section;
}

function generateDebugSection(): string {
  return `  // Debug configuration (development only)
  debug: {
    enabled: process.env.NODE_ENV === 'development',
    logQueries: true,
    logPoolEvents: true,
    slowQueryThreshold: 1000,
  },`;
}
