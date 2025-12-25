/**
 * Types for the Enhanced Init Wizard
 */

export type ProjectTemplate = 'minimal' | 'standard' | 'full' | 'enterprise';

export type FrameworkIntegration = 'none' | 'express' | 'fastify' | 'nestjs' | 'hono';

export interface InitFeatures {
  sharedSchema: boolean;
  crossSchemaQueries: boolean;
  healthChecks: boolean;
  metrics: boolean;
  debug: boolean;
}

export type DatabaseSetup = 'manual' | 'docker-compose' | 'existing-url';

export interface InitWizardAnswers {
  template: ProjectTemplate;
  framework: FrameworkIntegration;
  features: InitFeatures;
  databaseSetup: DatabaseSetup;
  isolationType: 'schema' | 'rls';
  dbEnvVar: string;
  migrationsFolder: string;
  sharedMigrationsFolder: string;
  schemaTemplate: string;
  useTypeScript: boolean;
  databaseUrl: string | undefined;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface TemplateContext {
  answers: InitWizardAnswers;
  projectName: string;
}

export const TEMPLATE_DESCRIPTIONS: Record<ProjectTemplate, { name: string; description: string }> = {
  minimal: {
    name: 'Minimal (config only)',
    description: 'Just the configuration file - you set up everything else',
  },
  standard: {
    name: 'Standard (config + folder structure)',
    description: 'Configuration with organized folder structure for migrations and seeds',
  },
  full: {
    name: 'Full (config + folders + example schemas)',
    description: 'Complete setup with example tenant and shared schemas',
  },
  enterprise: {
    name: 'Enterprise (full + CI/CD + Docker)',
    description: 'Production-ready setup with Docker, CI/CD, and monitoring',
  },
};

export const FRAMEWORK_DESCRIPTIONS: Record<FrameworkIntegration, { name: string; description: string }> = {
  none: {
    name: 'None (standalone)',
    description: 'No framework integration - use directly with Drizzle',
  },
  express: {
    name: 'Express',
    description: 'Middleware for Express.js applications',
  },
  fastify: {
    name: 'Fastify',
    description: 'Plugin for Fastify applications',
  },
  nestjs: {
    name: 'NestJS',
    description: 'Full module with decorators and guards',
  },
  hono: {
    name: 'Hono',
    description: 'Middleware for Hono applications',
  },
};

export const FEATURE_DESCRIPTIONS: Record<keyof InitFeatures, { name: string; description: string; default: boolean }> = {
  sharedSchema: {
    name: 'Shared schema support',
    description: 'Support for shared tables (plans, roles, etc.)',
    default: true,
  },
  crossSchemaQueries: {
    name: 'Cross-schema queries',
    description: 'Type-safe queries joining tenant and shared schemas',
    default: true,
  },
  healthChecks: {
    name: 'Health check endpoints',
    description: 'Pool health monitoring and metrics',
    default: true,
  },
  metrics: {
    name: 'Metrics (Prometheus)',
    description: 'Prometheus-compatible metrics endpoint',
    default: false,
  },
  debug: {
    name: 'Debug mode',
    description: 'Structured logging for development',
    default: false,
  },
};

export const DATABASE_SETUP_DESCRIPTIONS: Record<DatabaseSetup, { name: string; description: string }> = {
  manual: {
    name: "I'll configure manually",
    description: 'Set up DATABASE_URL yourself',
  },
  'docker-compose': {
    name: 'Generate docker-compose.yml',
    description: 'Create a Docker Compose file for PostgreSQL',
  },
  'existing-url': {
    name: 'Use existing DATABASE_URL',
    description: 'Use your current database connection',
  },
};
