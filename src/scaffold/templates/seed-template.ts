/**
 * Seed template generator
 *
 * @module scaffold/templates/seed-template
 */

import type { SeedTemplateContext } from '../types.js';

/**
 * Generate a seed file content
 *
 * @param context - Template context
 * @returns Generated TypeScript code for the seed
 *
 * @example
 * ```typescript
 * const content = generateSeedTemplate({
 *   seedName: 'initialData',
 *   type: 'tenant',
 *   tableName: 'users',
 * });
 * ```
 */
export function generateSeedTemplate(context: SeedTemplateContext): string {
  const { seedName, type, tableName } = context;

  if (type === 'shared') {
    return generateSharedSeedTemplate(seedName, tableName);
  }

  return generateTenantSeedTemplate(seedName, tableName);
}

function generateTenantSeedTemplate(seedName: string, tableName?: string): string {
  const tableImport = tableName
    ? `import { ${tableName} } from '../../src/db/schema/tenant/${tableName}.js';`
    : `// import { yourTable } from '../../src/db/schema/tenant/yourTable.js';`;

  const tableExample = tableName
    ? generateTableSeedExample(tableName)
    : generateGenericSeedExample();

  return `/**
 * Tenant seed: ${seedName}
 *
 * This seed runs in the context of each tenant's schema.
 * Use this to populate initial data for each tenant.
 *
 * @module seeds/tenant/${seedName}
 */

import type { SeedFunction } from 'drizzle-multitenant';
${tableImport}

/**
 * Seed function that populates tenant data
 *
 * @param db - Drizzle database instance scoped to the tenant
 * @param tenantId - The tenant ID being seeded
 *
 * @example
 * \`\`\`bash
 * npx drizzle-multitenant seed --file=./drizzle/seeds/tenant/${seedName}.ts --tenant=my-tenant
 * \`\`\`
 */
export const seed: SeedFunction = async (db, tenantId) => {
  console.log(\`Seeding tenant: \${tenantId}\`);

${tableExample}
};

export default seed;
`;
}

function generateSharedSeedTemplate(seedName: string, tableName?: string): string {
  const tableImport = tableName
    ? `import { ${tableName} } from '../../src/db/schema/shared/${tableName}.js';`
    : `// import { yourTable } from '../../src/db/schema/shared/yourTable.js';`;

  const tableExample = tableName
    ? generateSharedTableSeedExample(tableName)
    : generateGenericSharedSeedExample();

  return `/**
 * Shared seed: ${seedName}
 *
 * This seed runs against the shared/public schema.
 * Use this to populate global data like plans, roles, permissions, etc.
 *
 * @module seeds/shared/${seedName}
 */

import type { SharedSeedFunction } from 'drizzle-multitenant';
${tableImport}

/**
 * Seed function that populates shared data
 *
 * @param db - Drizzle database instance for the shared schema
 *
 * @example
 * \`\`\`bash
 * npx drizzle-multitenant seed:shared --file=./drizzle/seeds/shared/${seedName}.ts
 * \`\`\`
 */
export const seed: SharedSeedFunction = async (db) => {
  console.log('Seeding shared schema...');

${tableExample}
};

export default seed;
`;
}

function generateTableSeedExample(tableName: string): string {
  return `  // Insert data with conflict handling (idempotent)
  await db.insert(${tableName}).values([
    {
      name: 'Example Item 1',
      // Add your columns here
    },
    {
      name: 'Example Item 2',
      // Add your columns here
    },
  ]).onConflictDoNothing();

  console.log(\`Seeded ${tableName} for tenant: \${tenantId}\`);`;
}

function generateSharedTableSeedExample(tableName: string): string {
  return `  // Insert data with conflict handling (idempotent)
  await db.insert(${tableName}).values([
    {
      name: 'Example Item 1',
      // Add your columns here
    },
    {
      name: 'Example Item 2',
      // Add your columns here
    },
  ]).onConflictDoNothing();

  console.log('Seeded ${tableName} in shared schema');`;
}

function generateGenericSeedExample(): string {
  return `  // Example: Insert initial data
  // await db.insert(yourTable).values([
  //   { name: 'Item 1', description: 'Description 1' },
  //   { name: 'Item 2', description: 'Description 2' },
  // ]).onConflictDoNothing();

  // You can use tenantId to customize data per tenant
  // if (tenantId === 'demo-tenant') {
  //   await db.insert(yourTable).values([
  //     { name: 'Demo Item', description: 'Only for demo tenant' },
  //   ]);
  // }

  console.log(\`Seed completed for tenant: \${tenantId}\`);`;
}

function generateGenericSharedSeedExample(): string {
  return `  // Example: Insert shared data like plans, roles, permissions
  // await db.insert(plans).values([
  //   { id: 'free', name: 'Free', price: 0 },
  //   { id: 'pro', name: 'Pro', price: 29 },
  //   { id: 'enterprise', name: 'Enterprise', price: 99 },
  // ]).onConflictDoNothing();

  // await db.insert(roles).values([
  //   { id: 'admin', name: 'Administrator', permissions: ['*'] },
  //   { id: 'user', name: 'User', permissions: ['read'] },
  // ]).onConflictDoNothing();

  console.log('Shared seed completed');`;
}
