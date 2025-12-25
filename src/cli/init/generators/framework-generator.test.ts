import { describe, it, expect } from 'vitest';
import { generateFrameworkFiles, getFrameworkDependencies } from './framework-generator.js';
import type { InitWizardAnswers } from '../types.js';

function createDefaultAnswers(overrides: Partial<InitWizardAnswers> = {}): InitWizardAnswers {
  return {
    template: 'full',
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

describe('getFrameworkDependencies', () => {
  it('should return empty dependencies for none', () => {
    const deps = getFrameworkDependencies('none');

    expect(deps.dependencies).toEqual([]);
    expect(deps.devDependencies).toEqual([]);
  });

  it('should return Express dependencies', () => {
    const deps = getFrameworkDependencies('express');

    expect(deps.dependencies).toContain('express');
    expect(deps.devDependencies).toContain('@types/express');
  });

  it('should return Fastify dependencies', () => {
    const deps = getFrameworkDependencies('fastify');

    expect(deps.dependencies).toContain('fastify');
    expect(deps.dependencies).toContain('fastify-plugin');
  });

  it('should return NestJS dependencies', () => {
    const deps = getFrameworkDependencies('nestjs');

    expect(deps.dependencies).toContain('@nestjs/common');
    expect(deps.dependencies).toContain('@nestjs/core');
    expect(deps.dependencies).toContain('reflect-metadata');
    expect(deps.devDependencies).toContain('@nestjs/cli');
  });

  it('should return Hono dependencies', () => {
    const deps = getFrameworkDependencies('hono');

    expect(deps.dependencies).toContain('hono');
  });
});

describe('generateFrameworkFiles', () => {
  describe('none framework', () => {
    it('should return empty array for none', () => {
      const answers = createDefaultAnswers({ framework: 'none' });
      const files = generateFrameworkFiles(answers);

      expect(files).toEqual([]);
    });
  });

  describe('Express framework', () => {
    it('should generate Express middleware file', () => {
      const answers = createDefaultAnswers({ framework: 'express' });
      const files = generateFrameworkFiles(answers);

      const middleware = files.find(f => f.path.includes('middleware/tenant'));
      expect(middleware).toBeDefined();
      expect(middleware?.content).toContain('createTenantMiddleware');
      expect(middleware?.content).toContain('x-tenant-id');
    });

    it('should generate Express app file', () => {
      const answers = createDefaultAnswers({ framework: 'express' });
      const files = generateFrameworkFiles(answers);

      const app = files.find(f => f.path.includes('app.ts'));
      expect(app).toBeDefined();
      expect(app?.content).toContain('express');
      expect(app?.content).toContain('/health');
      expect(app?.content).toContain('/api/users');
    });

    it('should generate JavaScript files when disabled', () => {
      const answers = createDefaultAnswers({
        framework: 'express',
        useTypeScript: false,
      });
      const files = generateFrameworkFiles(answers);

      const middleware = files.find(f => f.path.includes('middleware/tenant.js'));
      expect(middleware).toBeDefined();
      expect(middleware?.content).toContain('require');
      expect(middleware?.content).not.toContain('import type');
    });
  });

  describe('Fastify framework', () => {
    it('should generate Fastify plugin file', () => {
      const answers = createDefaultAnswers({ framework: 'fastify' });
      const files = generateFrameworkFiles(answers);

      const plugin = files.find(f => f.path.includes('plugins/tenant'));
      expect(plugin).toBeDefined();
      expect(plugin?.content).toContain('createTenantPlugin');
      expect(plugin?.content).toContain('fp');
    });

    it('should generate Fastify app file', () => {
      const answers = createDefaultAnswers({ framework: 'fastify' });
      const files = generateFrameworkFiles(answers);

      const app = files.find(f => f.path.includes('app.ts'));
      expect(app).toBeDefined();
      expect(app?.content).toContain('Fastify');
      expect(app?.content).toContain('/health');
    });
  });

  describe('NestJS framework', () => {
    it('should generate NestJS module files', () => {
      const answers = createDefaultAnswers({ framework: 'nestjs' });
      const files = generateFrameworkFiles(answers);

      expect(files.some(f => f.path.includes('tenant/tenant.module.ts'))).toBe(true);
      expect(files.some(f => f.path.includes('users/users.service.ts'))).toBe(true);
      expect(files.some(f => f.path.includes('users/users.controller.ts'))).toBe(true);
      expect(files.some(f => f.path.includes('users/users.module.ts'))).toBe(true);
      expect(files.some(f => f.path.includes('app.module.ts'))).toBe(true);
      expect(files.some(f => f.path.includes('main.ts'))).toBe(true);
    });

    it('should use NestJS decorators', () => {
      const answers = createDefaultAnswers({ framework: 'nestjs' });
      const files = generateFrameworkFiles(answers);

      const service = files.find(f => f.path.includes('users.service.ts'));
      expect(service?.content).toContain('@Injectable');
      expect(service?.content).toContain('@InjectTenantDb');
    });

    it('should include health module', () => {
      const answers = createDefaultAnswers({ framework: 'nestjs' });
      const files = generateFrameworkFiles(answers);

      const health = files.find(f => f.path.includes('health/health.controller.ts'));
      expect(health).toBeDefined();
      expect(health?.content).toContain('@PublicRoute');
    });
  });

  describe('Hono framework', () => {
    it('should generate Hono middleware file', () => {
      const answers = createDefaultAnswers({ framework: 'hono' });
      const files = generateFrameworkFiles(answers);

      const middleware = files.find(f => f.path.includes('middleware/tenant'));
      expect(middleware).toBeDefined();
      expect(middleware?.content).toContain('runWithTenant');
    });

    it('should generate Hono app file', () => {
      const answers = createDefaultAnswers({ framework: 'hono' });
      const files = generateFrameworkFiles(answers);

      const app = files.find(f => f.path.includes('app.ts'));
      expect(app).toBeDefined();
      expect(app?.content).toContain('Hono');
      expect(app?.content).toContain('/health');
    });

    it('should generate JavaScript files when disabled', () => {
      const answers = createDefaultAnswers({
        framework: 'hono',
        useTypeScript: false,
      });
      const files = generateFrameworkFiles(answers);

      const app = files.find(f => f.path.includes('app.js'));
      expect(app).toBeDefined();
      expect(app?.content).toContain('require');
    });
  });
});
