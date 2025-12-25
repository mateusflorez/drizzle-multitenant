/**
 * Folder structure generator
 */

import type { GeneratedFile, InitWizardAnswers } from '../types.js';

export interface FolderStructure {
  folders: string[];
  files: GeneratedFile[];
}

export function generateFolderStructure(answers: InitWizardAnswers): FolderStructure {
  switch (answers.template) {
    case 'minimal':
      return generateMinimalStructure(answers);
    case 'standard':
      return generateStandardStructure(answers);
    case 'full':
      return generateFullStructure(answers);
    case 'enterprise':
      return generateEnterpriseStructure(answers);
    default:
      return generateMinimalStructure(answers);
  }
}

function generateMinimalStructure(answers: InitWizardAnswers): FolderStructure {
  const folders: string[] = [answers.migrationsFolder];

  if (answers.features.sharedSchema) {
    folders.push(answers.sharedMigrationsFolder);
  }

  return {
    folders,
    files: [
      { path: `${answers.migrationsFolder}/.gitkeep`, content: '' },
      ...(answers.features.sharedSchema
        ? [{ path: `${answers.sharedMigrationsFolder}/.gitkeep`, content: '' }]
        : []),
    ],
  };
}

function generateStandardStructure(answers: InitWizardAnswers): FolderStructure {
  const folders: string[] = [
    answers.migrationsFolder,
    'drizzle/seeds/tenant',
    'src/db/schema/tenant',
  ];

  const files: GeneratedFile[] = [
    { path: `${answers.migrationsFolder}/.gitkeep`, content: '' },
    { path: 'drizzle/seeds/tenant/.gitkeep', content: '' },
    { path: 'src/db/schema/tenant/.gitkeep', content: '' },
  ];

  if (answers.features.sharedSchema) {
    folders.push(answers.sharedMigrationsFolder);
    folders.push('drizzle/seeds/shared');
    folders.push('src/db/schema/shared');

    files.push({ path: `${answers.sharedMigrationsFolder}/.gitkeep`, content: '' });
    files.push({ path: 'drizzle/seeds/shared/.gitkeep', content: '' });
    files.push({ path: 'src/db/schema/shared/.gitkeep', content: '' });
  }

  // Add .env.example
  files.push(generateEnvExample(answers));

  return { folders, files };
}

function generateFullStructure(answers: InitWizardAnswers): FolderStructure {
  const structure = generateStandardStructure(answers);

  // Add example schemas
  structure.files.push(...generateExampleSchemas(answers));

  // Add example seeds
  structure.files.push(...generateExampleSeeds(answers));

  // Add db index file
  structure.files.push(generateDbIndexFile(answers));

  return structure;
}

function generateEnterpriseStructure(answers: InitWizardAnswers): FolderStructure {
  const structure = generateFullStructure(answers);

  // Add .github folder
  structure.folders.push('.github/workflows');

  // Add Docker files
  structure.files.push(generateDockerfile());
  structure.files.push(generateDockerignore());

  // Add CI/CD files
  structure.files.push(generateGitHubWorkflow(answers));

  // Add additional config files
  structure.files.push(generatePrettierConfig());
  structure.files.push(generateEslintConfig());

  return structure;
}

function generateEnvExample(answers: InitWizardAnswers): GeneratedFile {
  let content = `# Database Configuration
${answers.dbEnvVar}=postgresql://postgres:postgres@localhost:5432/myapp

# Environment
NODE_ENV=development
`;

  if (answers.features.debug) {
    content += `
# Debug
DEBUG=drizzle-multitenant:*
`;
  }

  return { path: '.env.example', content };
}

function generateExampleSchemas(answers: InitWizardAnswers): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const ext = answers.useTypeScript ? 'ts' : 'js';

  // Tenant schema - users
  files.push({
    path: `src/db/schema/tenant/users.${ext}`,
    content: answers.useTypeScript
      ? `import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatar: text('avatar'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
`
      : `const { pgTable, uuid, text, timestamp } = require('drizzle-orm/pg-core');

const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatar: text('avatar'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

module.exports = { users };
`,
  });

  // Tenant schema index
  files.push({
    path: `src/db/schema/tenant/index.${ext}`,
    content: answers.useTypeScript
      ? `export * from './users.js';
`
      : `module.exports = {
  ...require('./users.js'),
};
`,
  });

  // Shared schema (if enabled)
  if (answers.features.sharedSchema) {
    files.push({
      path: `src/db/schema/shared/plans.${ext}`,
      content: answers.useTypeScript
        ? `import { pgTable, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  price: integer('price').notNull().default(0),
  features: text('features').array(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
`
        : `const { pgTable, text, integer, boolean, timestamp } = require('drizzle-orm/pg-core');

const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  price: integer('price').notNull().default(0),
  features: text('features').array(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

module.exports = { plans };
`,
    });

    files.push({
      path: `src/db/schema/shared/index.${ext}`,
      content: answers.useTypeScript
        ? `export * from './plans.js';
`
        : `module.exports = {
  ...require('./plans.js'),
};
`,
    });
  }

  return files;
}

function generateExampleSeeds(answers: InitWizardAnswers): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const ext = answers.useTypeScript ? 'ts' : 'js';

  // Tenant seed
  files.push({
    path: `drizzle/seeds/tenant/initial.${ext}`,
    content: answers.useTypeScript
      ? `import type { SeedFunction } from 'drizzle-multitenant';
import { users } from '../../../src/db/schema/tenant/index.js';

export const seed: SeedFunction = async (db) => {
  await db.insert(users).values([
    {
      email: 'admin@example.com',
      name: 'Admin User',
    },
    {
      email: 'user@example.com',
      name: 'Regular User',
    },
  ]).onConflictDoNothing();
};
`
      : `const { users } = require('../../../src/db/schema/tenant/index.js');

/** @type {import('drizzle-multitenant').SeedFunction} */
const seed = async (db) => {
  await db.insert(users).values([
    {
      email: 'admin@example.com',
      name: 'Admin User',
    },
    {
      email: 'user@example.com',
      name: 'Regular User',
    },
  ]).onConflictDoNothing();
};

module.exports = { seed };
`,
  });

  // Shared seed (if enabled)
  if (answers.features.sharedSchema) {
    files.push({
      path: `drizzle/seeds/shared/plans.${ext}`,
      content: answers.useTypeScript
        ? `import type { SharedSeedFunction } from 'drizzle-multitenant';
import { plans } from '../../../src/db/schema/shared/index.js';

export const seed: SharedSeedFunction = async (db) => {
  await db.insert(plans).values([
    {
      id: 'free',
      name: 'Free',
      description: 'Basic features for individuals',
      price: 0,
      features: ['Basic support', '1 project', '100 requests/day'],
    },
    {
      id: 'pro',
      name: 'Pro',
      description: 'Advanced features for professionals',
      price: 2900, // $29.00 in cents
      features: ['Priority support', '10 projects', '10,000 requests/day', 'Analytics'],
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      description: 'Custom solutions for large teams',
      price: 9900, // $99.00 in cents
      features: ['24/7 support', 'Unlimited projects', 'Unlimited requests', 'Custom integrations'],
    },
  ]).onConflictDoNothing();
};
`
        : `const { plans } = require('../../../src/db/schema/shared/index.js');

/** @type {import('drizzle-multitenant').SharedSeedFunction} */
const seed = async (db) => {
  await db.insert(plans).values([
    {
      id: 'free',
      name: 'Free',
      description: 'Basic features for individuals',
      price: 0,
      features: ['Basic support', '1 project', '100 requests/day'],
    },
    {
      id: 'pro',
      name: 'Pro',
      description: 'Advanced features for professionals',
      price: 2900,
      features: ['Priority support', '10 projects', '10,000 requests/day', 'Analytics'],
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      description: 'Custom solutions for large teams',
      price: 9900,
      features: ['24/7 support', 'Unlimited projects', 'Unlimited requests', 'Custom integrations'],
    },
  ]).onConflictDoNothing();
};

module.exports = { seed };
`,
    });
  }

  return files;
}

function generateDbIndexFile(answers: InitWizardAnswers): GeneratedFile {
  const ext = answers.useTypeScript ? 'ts' : 'js';

  if (answers.useTypeScript) {
    let content = `import { createTenantManager, createTenantContext } from 'drizzle-multitenant';
import config from '../../tenant.config.js';

// Create tenant manager (singleton)
export const tenantManager = createTenantManager(config);

// Create tenant context for AsyncLocalStorage
export const tenantContext = createTenantContext(tenantManager);

// Export convenience functions
export const { runWithTenant, getTenantId, getTenantDb, isInTenantContext } = tenantContext;

// Get shared database instance
export const sharedDb = tenantManager.getSharedDb();
`;

    if (answers.features.crossSchemaQueries) {
      content += `
// Cross-schema query helper
export { withShared } from 'drizzle-multitenant/cross-schema';
`;
    }

    return { path: `src/db/index.${ext}`, content };
  }

  let content = `const { createTenantManager, createTenantContext } = require('drizzle-multitenant');
const config = require('../../tenant.config.js');

// Create tenant manager (singleton)
const tenantManager = createTenantManager(config);

// Create tenant context for AsyncLocalStorage
const tenantContext = createTenantContext(tenantManager);

// Get shared database instance
const sharedDb = tenantManager.getSharedDb();

module.exports = {
  tenantManager,
  tenantContext,
  runWithTenant: tenantContext.runWithTenant,
  getTenantId: tenantContext.getTenantId,
  getTenantDb: tenantContext.getTenantDb,
  isInTenantContext: tenantContext.isInTenantContext,
  sharedDb,
};
`;

  return { path: `src/db/index.${ext}`, content };
}

function generateDockerfile(): GeneratedFile {
  return {
    path: 'Dockerfile',
    content: `# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/drizzle ./drizzle

# Install production dependencies only
RUN npm ci --only=production

# Set ownership
RUN chown -R appuser:nodejs /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
`,
  };
}

function generateDockerignore(): GeneratedFile {
  return {
    path: '.dockerignore',
    content: `node_modules
npm-debug.log
.git
.gitignore
.env
.env.*
!.env.example
*.md
.vscode
.idea
coverage
.nyc_output
dist
*.log
`,
  };
}

function generateGitHubWorkflow(answers: InitWizardAnswers): GeneratedFile {
  return {
    path: '.github/workflows/ci.yml',
    content: `name: CI

on:
  push:
    branches: [main, development]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Run tests
        run: npm test
        env:
          ${answers.dbEnvVar}: postgresql://postgres:postgres@localhost:5432/test

      - name: Build
        run: npm run build

  lint-schemas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint database schemas
        run: npx drizzle-multitenant lint --format=github || true
`,
  };
}

function generatePrettierConfig(): GeneratedFile {
  return {
    path: '.prettierrc',
    content: `{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 100
}
`,
  };
}

function generateEslintConfig(): GeneratedFile {
  return {
    path: 'eslint.config.js',
    content: `import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }
);
`,
  };
}
