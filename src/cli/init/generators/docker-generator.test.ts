import { describe, it, expect } from 'vitest';
import { generateDockerCompose, generateInitDbSql } from './docker-generator.js';
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
    databaseSetup: 'docker-compose',
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

describe('generateDockerCompose', () => {
  it('should generate docker-compose.yml', () => {
    const answers = createDefaultAnswers();
    const result = generateDockerCompose(answers);

    expect(result.path).toBe('docker-compose.yml');
    expect(result.content).toContain("version: '3.8'");
    expect(result.content).toContain('postgres:15-alpine');
  });

  it('should include PostgreSQL configuration', () => {
    const answers = createDefaultAnswers();
    const result = generateDockerCompose(answers);

    expect(result.content).toContain('POSTGRES_USER');
    expect(result.content).toContain('POSTGRES_PASSWORD');
    expect(result.content).toContain('POSTGRES_DB');
    expect(result.content).toContain("'5432:5432'");
  });

  it('should include healthcheck', () => {
    const answers = createDefaultAnswers();
    const result = generateDockerCompose(answers);

    expect(result.content).toContain('healthcheck');
    expect(result.content).toContain('pg_isready');
  });

  it('should include volume configuration', () => {
    const answers = createDefaultAnswers();
    const result = generateDockerCompose(answers);

    expect(result.content).toContain('postgres_data');
    expect(result.content).toContain('/var/lib/postgresql/data');
  });

  it('should reference init-db.sql', () => {
    const answers = createDefaultAnswers();
    const result = generateDockerCompose(answers);

    expect(result.content).toContain('init-db.sql');
    expect(result.content).toContain('/docker-entrypoint-initdb.d/init.sql');
  });
});

describe('generateInitDbSql', () => {
  it('should generate init-db.sql', () => {
    const answers = createDefaultAnswers();
    const result = generateInitDbSql(answers);

    expect(result.path).toBe('init-db.sql');
  });

  it('should create uuid-ossp extension', () => {
    const answers = createDefaultAnswers();
    const result = generateInitDbSql(answers);

    expect(result.content).toContain('uuid-ossp');
  });

  it('should create tenants table', () => {
    const answers = createDefaultAnswers();
    const result = generateInitDbSql(answers);

    expect(result.content).toContain('CREATE TABLE IF NOT EXISTS tenants');
    expect(result.content).toContain('id TEXT PRIMARY KEY');
    expect(result.content).toContain('name TEXT NOT NULL');
    expect(result.content).toContain('plan_id TEXT');
  });

  it('should include updated_at trigger', () => {
    const answers = createDefaultAnswers();
    const result = generateInitDbSql(answers);

    expect(result.content).toContain('update_updated_at');
    expect(result.content).toContain('CREATE TRIGGER');
  });

  it('should insert example tenants', () => {
    const answers = createDefaultAnswers();
    const result = generateInitDbSql(answers);

    expect(result.content).toContain("'acme'");
    expect(result.content).toContain("'globex'");
    expect(result.content).toContain("'initech'");
  });
});
