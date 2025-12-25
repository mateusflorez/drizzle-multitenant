import { describe, it, expect } from 'vitest';
import { generateConfigFile } from './config-generator.js';
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

describe('generateConfigFile', () => {
  describe('TypeScript config', () => {
    it('should generate TypeScript config file', () => {
      const answers = createDefaultAnswers();
      const result = generateConfigFile(answers);

      expect(result.path).toBe('tenant.config.ts');
      expect(result.content).toContain("import { defineConfig } from 'drizzle-multitenant'");
      expect(result.content).toContain('export default defineConfig');
    });

    it('should include shared schema imports when enabled', () => {
      const answers = createDefaultAnswers({
        features: { ...createDefaultAnswers().features, sharedSchema: true },
      });
      const result = generateConfigFile(answers);

      expect(result.content).toContain('sharedFolder');
      expect(result.content).toContain('sharedSchema');
    });

    it('should not include shared schema when disabled', () => {
      const answers = createDefaultAnswers({
        template: 'minimal',
        features: { ...createDefaultAnswers().features, sharedSchema: false },
      });
      const result = generateConfigFile(answers);

      expect(result.content).not.toContain('sharedFolder');
    });

    it('should include debug config when enabled', () => {
      const answers = createDefaultAnswers({
        features: { ...createDefaultAnswers().features, debug: true },
      });
      const result = generateConfigFile(answers);

      expect(result.content).toContain('debug:');
      expect(result.content).toContain('logQueries: true');
    });

    it('should use schema isolation template', () => {
      const answers = createDefaultAnswers({
        schemaTemplate: 'org_${id}',
      });
      const result = generateConfigFile(answers);

      expect(result.content).toContain('org_${id}');
    });

    it('should handle RLS isolation type', () => {
      const answers = createDefaultAnswers({
        isolationType: 'rls',
      });
      const result = generateConfigFile(answers);

      expect(result.content).toContain("type: 'rls'");
      expect(result.content).not.toContain('schemaNameTemplate');
    });
  });

  describe('JavaScript config', () => {
    it('should generate JavaScript config file', () => {
      const answers = createDefaultAnswers({ useTypeScript: false });
      const result = generateConfigFile(answers);

      expect(result.path).toBe('tenant.config.js');
      expect(result.content).toContain('// @ts-check');
      expect(result.content).toContain("require('drizzle-multitenant')");
      expect(result.content).toContain('module.exports = defineConfig');
    });
  });

  describe('minimal template', () => {
    it('should include inline schema for minimal template', () => {
      const answers = createDefaultAnswers({ template: 'minimal' });
      const result = generateConfigFile(answers);

      expect(result.content).toContain('const users = pgTable');
      expect(result.content).toContain('email: text');
    });
  });

  describe('database URL', () => {
    it('should include existing database URL when provided', () => {
      const answers = createDefaultAnswers({
        databaseSetup: 'existing-url',
        databaseUrl: 'postgresql://localhost/mydb',
      });
      const result = generateConfigFile(answers);

      expect(result.content).toContain('postgresql://localhost/mydb');
    });
  });

  describe('health checks', () => {
    it('should include hooks when health checks enabled', () => {
      const answers = createDefaultAnswers({
        features: { ...createDefaultAnswers().features, healthChecks: true },
      });
      const result = generateConfigFile(answers);

      expect(result.content).toContain('onPoolCreated');
      expect(result.content).toContain('onPoolEvicted');
      expect(result.content).toContain('onError');
    });

    it('should not include hooks when health checks disabled', () => {
      const answers = createDefaultAnswers({
        features: { ...createDefaultAnswers().features, healthChecks: false },
      });
      const result = generateConfigFile(answers);

      expect(result.content).not.toContain('onPoolCreated');
    });
  });
});
