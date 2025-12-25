/**
 * Docker configuration generator
 */

import type { GeneratedFile, InitWizardAnswers } from '../types.js';

export function generateDockerCompose(answers: InitWizardAnswers): GeneratedFile {
  const content = `# Docker Compose for local development
# Start with: docker-compose up -d

version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: drizzle-multitenant-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: myapp
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5

  # Optional: pgAdmin for database management
  # pgadmin:
  #   image: dpage/pgadmin4:latest
  #   container_name: drizzle-multitenant-pgadmin
  #   restart: unless-stopped
  #   environment:
  #     PGADMIN_DEFAULT_EMAIL: admin@admin.com
  #     PGADMIN_DEFAULT_PASSWORD: admin
  #   ports:
  #     - '5050:80'
  #   depends_on:
  #     - postgres

volumes:
  postgres_data:

# Networks (optional, for connecting with other services)
# networks:
#   default:
#     name: app-network
`;

  return { path: 'docker-compose.yml', content };
}

export function generateInitDbSql(answers: InitWizardAnswers): GeneratedFile {
  const content = `-- Initial database setup
-- This file is executed when the PostgreSQL container is first created

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create tenants table in public schema (for shared data)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan_id TEXT DEFAULT 'free',
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Insert some example tenants (for testing)
INSERT INTO tenants (id, name, plan_id) VALUES
    ('acme', 'Acme Corporation', 'pro'),
    ('globex', 'Globex Inc', 'enterprise'),
    ('initech', 'Initech', 'free')
ON CONFLICT (id) DO NOTHING;

-- Grant permissions (adjust as needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_app_user;
`;

  return { path: 'init-db.sql', content };
}
