import { describe, it, expect } from 'vitest';
import { generateFolderStructure } from './structure-generator.js';
import type { InitWizardAnswers } from '../types.js';

function createDefaultAnswers(overrides: Partial<InitWizardAnswers> = {}): InitWizardAnswers {
  return {
    template: 'standard',
    framework: 'none',
    features: {
      sharedSchema: true,
      crossSchemaQueries: true,
      healthChecks: true,
      metrics: false,
      debug: false,
    },
    databaseSetup: 'manual',
    isolationType: 'schema',
    dbEnvVar: 'DATABASE_URL',
    migrationsFolder: './drizzle/tenant-migrations',
    sharedMigrationsFolder: './drizzle/shared-migrations',
    schemaTemplate: 'tenant_${id}',
    useTypeScript: true,
    databaseUrl: undefined,
    ...overrides,
  };
}

describe('generateFolderStructure', () => {
  describe('minimal template', () => {
    it('should generate minimal structure', () => {
      const answers = createDefaultAnswers({
        template: 'minimal',
        features: { ...createDefaultAnswers().features, sharedSchema: false },
      });
      const result = generateFolderStructure(answers);

      expect(result.folders).toContain('./drizzle/tenant-migrations');
      expect(result.folders).not.toContain('./drizzle/shared-migrations');
    });

    it('should include shared migrations folder when enabled', () => {
      const answers = createDefaultAnswers({
        template: 'minimal',
        features: { ...createDefaultAnswers().features, sharedSchema: true },
      });
      const result = generateFolderStructure(answers);

      expect(result.folders).toContain('./drizzle/shared-migrations');
    });
  });

  describe('standard template', () => {
    it('should generate standard structure with seeds folders', () => {
      const answers = createDefaultAnswers({ template: 'standard' });
      const result = generateFolderStructure(answers);

      expect(result.folders).toContain('./drizzle/tenant-migrations');
      expect(result.folders).toContain('drizzle/seeds/tenant');
      expect(result.folders).toContain('src/db/schema/tenant');
    });

    it('should include shared folders when enabled', () => {
      const answers = createDefaultAnswers({
        template: 'standard',
        features: { ...createDefaultAnswers().features, sharedSchema: true },
      });
      const result = generateFolderStructure(answers);

      expect(result.folders).toContain('drizzle/seeds/shared');
      expect(result.folders).toContain('src/db/schema/shared');
    });

    it('should generate .env.example file', () => {
      const answers = createDefaultAnswers({ template: 'standard' });
      const result = generateFolderStructure(answers);

      const envFile = result.files.find(f => f.path === '.env.example');
      expect(envFile).toBeDefined();
      expect(envFile?.content).toContain('DATABASE_URL');
    });
  });

  describe('full template', () => {
    it('should generate example schemas', () => {
      const answers = createDefaultAnswers({ template: 'full' });
      const result = generateFolderStructure(answers);

      const usersSchema = result.files.find(f => f.path.includes('users.ts'));
      expect(usersSchema).toBeDefined();
      expect(usersSchema?.content).toContain("pgTable('users'");
    });

    it('should generate example seeds', () => {
      const answers = createDefaultAnswers({ template: 'full' });
      const result = generateFolderStructure(answers);

      const tenantSeed = result.files.find(f => f.path.includes('seeds/tenant/initial'));
      expect(tenantSeed).toBeDefined();
      expect(tenantSeed?.content).toContain('SeedFunction');
    });

    it('should generate shared schema when enabled', () => {
      const answers = createDefaultAnswers({
        template: 'full',
        features: { ...createDefaultAnswers().features, sharedSchema: true },
      });
      const result = generateFolderStructure(answers);

      const plansSchema = result.files.find(f => f.path.includes('shared/plans'));
      expect(plansSchema).toBeDefined();
      expect(plansSchema?.content).toContain("pgTable('plans'");
    });

    it('should generate db index file', () => {
      const answers = createDefaultAnswers({ template: 'full' });
      const result = generateFolderStructure(answers);

      const dbIndex = result.files.find(f => f.path === 'src/db/index.ts');
      expect(dbIndex).toBeDefined();
      expect(dbIndex?.content).toContain('createTenantManager');
      expect(dbIndex?.content).toContain('createTenantContext');
    });
  });

  describe('enterprise template', () => {
    it('should include all full template features', () => {
      const answers = createDefaultAnswers({ template: 'enterprise' });
      const result = generateFolderStructure(answers);

      const usersSchema = result.files.find(f => f.path.includes('users.ts'));
      expect(usersSchema).toBeDefined();
    });

    it('should generate Dockerfile', () => {
      const answers = createDefaultAnswers({ template: 'enterprise' });
      const result = generateFolderStructure(answers);

      const dockerfile = result.files.find(f => f.path === 'Dockerfile');
      expect(dockerfile).toBeDefined();
      expect(dockerfile?.content).toContain('FROM node:20-alpine');
      expect(dockerfile?.content).toContain('HEALTHCHECK');
    });

    it('should generate .dockerignore', () => {
      const answers = createDefaultAnswers({ template: 'enterprise' });
      const result = generateFolderStructure(answers);

      const dockerignore = result.files.find(f => f.path === '.dockerignore');
      expect(dockerignore).toBeDefined();
      expect(dockerignore?.content).toContain('node_modules');
    });

    it('should generate GitHub workflow', () => {
      const answers = createDefaultAnswers({ template: 'enterprise' });
      const result = generateFolderStructure(answers);

      const workflow = result.files.find(f => f.path.includes('.github/workflows/ci.yml'));
      expect(workflow).toBeDefined();
      expect(workflow?.content).toContain('npm test');
      expect(workflow?.content).toContain('postgres:15');
    });

    it('should generate ESLint config', () => {
      const answers = createDefaultAnswers({ template: 'enterprise' });
      const result = generateFolderStructure(answers);

      const eslint = result.files.find(f => f.path === 'eslint.config.js');
      expect(eslint).toBeDefined();
    });

    it('should generate Prettier config', () => {
      const answers = createDefaultAnswers({ template: 'enterprise' });
      const result = generateFolderStructure(answers);

      const prettier = result.files.find(f => f.path === '.prettierrc');
      expect(prettier).toBeDefined();
    });
  });

  describe('JavaScript output', () => {
    it('should generate .js files when TypeScript disabled', () => {
      const answers = createDefaultAnswers({
        template: 'full',
        useTypeScript: false,
      });
      const result = generateFolderStructure(answers);

      const usersSchema = result.files.find(f => f.path.includes('users.js'));
      expect(usersSchema).toBeDefined();
      expect(usersSchema?.content).toContain('module.exports');
    });
  });
});
