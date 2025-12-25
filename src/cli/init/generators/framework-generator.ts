/**
 * Framework integration generator
 */

import type { GeneratedFile, InitWizardAnswers, FrameworkIntegration } from '../types.js';

export function generateFrameworkFiles(answers: InitWizardAnswers): GeneratedFile[] {
  switch (answers.framework) {
    case 'express':
      return generateExpressFiles(answers);
    case 'fastify':
      return generateFastifyFiles(answers);
    case 'nestjs':
      return generateNestJSFiles(answers);
    case 'hono':
      return generateHonoFiles(answers);
    default:
      return [];
  }
}

export function getFrameworkDependencies(framework: FrameworkIntegration): {
  dependencies: string[];
  devDependencies: string[];
} {
  switch (framework) {
    case 'express':
      return {
        dependencies: ['express'],
        devDependencies: ['@types/express'],
      };
    case 'fastify':
      return {
        dependencies: ['fastify', 'fastify-plugin'],
        devDependencies: [],
      };
    case 'nestjs':
      return {
        dependencies: ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs'],
        devDependencies: ['@nestjs/cli', '@nestjs/testing'],
      };
    case 'hono':
      return {
        dependencies: ['hono'],
        devDependencies: [],
      };
    default:
      return { dependencies: [], devDependencies: [] };
  }
}

function generateExpressFiles(answers: InitWizardAnswers): GeneratedFile[] {
  const ext = answers.useTypeScript ? 'ts' : 'js';
  const files: GeneratedFile[] = [];

  // Middleware file
  files.push({
    path: `src/middleware/tenant.${ext}`,
    content: answers.useTypeScript
      ? `import type { Request, Response, NextFunction } from 'express';
import { createTenantMiddleware } from 'drizzle-multitenant/express';
import { tenantManager } from '../db/index.js';

// Extract tenant ID from request
// Customize this function based on your needs:
// - From header: x-tenant-id
// - From subdomain: tenant.example.com
// - From path: /api/tenants/:tenantId/*
// - From JWT token: req.user.tenantId
const extractTenantId = (req: Request): string | null => {
  // Option 1: From header
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant && typeof headerTenant === 'string') {
    return headerTenant;
  }

  // Option 2: From subdomain
  const host = req.hostname;
  const subdomain = host.split('.')[0];
  if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
    return subdomain;
  }

  // Option 3: From path parameter (requires route setup)
  // return req.params.tenantId;

  return null;
};

export const tenantMiddleware = createTenantMiddleware({
  tenantManager,
  extractTenantId,
  onTenantNotFound: (req: Request, res: Response) => {
    res.status(400).json({
      error: 'Tenant ID required',
      message: 'Please provide x-tenant-id header or use tenant subdomain',
    });
  },
  onError: (err: Error, req: Request, res: Response) => {
    console.error('Tenant middleware error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  },
});

// Public routes that don't require tenant context
export const publicRoutes = ['/health', '/api/health', '/api/public'];

export const tenantRequired = (req: Request, res: Response, next: NextFunction) => {
  if (publicRoutes.some(route => req.path.startsWith(route))) {
    return next();
  }
  return tenantMiddleware(req, res, next);
};
`
      : `const { createTenantMiddleware } = require('drizzle-multitenant/express');
const { tenantManager } = require('../db/index.js');

const extractTenantId = (req) => {
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant) {
    return headerTenant;
  }

  const host = req.hostname;
  const subdomain = host.split('.')[0];
  if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
    return subdomain;
  }

  return null;
};

const tenantMiddleware = createTenantMiddleware({
  tenantManager,
  extractTenantId,
  onTenantNotFound: (req, res) => {
    res.status(400).json({
      error: 'Tenant ID required',
      message: 'Please provide x-tenant-id header or use tenant subdomain',
    });
  },
  onError: (err, req, res) => {
    console.error('Tenant middleware error:', err);
    res.status(500).json({
      error: 'Internal server error',
    });
  },
});

const publicRoutes = ['/health', '/api/health', '/api/public'];

const tenantRequired = (req, res, next) => {
  if (publicRoutes.some(route => req.path.startsWith(route))) {
    return next();
  }
  return tenantMiddleware(req, res, next);
};

module.exports = { tenantMiddleware, tenantRequired, publicRoutes };
`,
  });

  // Example app setup
  files.push({
    path: `src/app.${ext}`,
    content: answers.useTypeScript
      ? `import express from 'express';
import { tenantRequired } from './middleware/tenant.js';
import { getTenantDb, getTenantId } from './db/index.js';

const app = express();

app.use(express.json());

// Health check (public)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply tenant middleware to all routes below
app.use(tenantRequired);

// Example tenant-scoped route
app.get('/api/users', async (req, res) => {
  try {
    const db = getTenantDb();
    const tenantId = getTenantId();

    // Query uses tenant-specific database connection
    const users = await db.query.users.findMany();

    res.json({ tenantId, users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default app;
`
      : `const express = require('express');
const { tenantRequired } = require('./middleware/tenant.js');
const { getTenantDb, getTenantId } = require('./db/index.js');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(tenantRequired);

app.get('/api/users', async (req, res) => {
  try {
    const db = getTenantDb();
    const tenantId = getTenantId();
    const users = await db.query.users.findMany();
    res.json({ tenantId, users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

module.exports = app;
`,
  });

  return files;
}

function generateFastifyFiles(answers: InitWizardAnswers): GeneratedFile[] {
  const ext = answers.useTypeScript ? 'ts' : 'js';
  const files: GeneratedFile[] = [];

  files.push({
    path: `src/plugins/tenant.${ext}`,
    content: answers.useTypeScript
      ? `import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { createTenantPlugin } from 'drizzle-multitenant/fastify';
import { tenantManager } from '../db/index.js';

const extractTenantId = (req: FastifyRequest): string | null => {
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant && typeof headerTenant === 'string') {
    return headerTenant;
  }

  const host = req.hostname;
  const subdomain = host.split('.')[0];
  if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
    return subdomain;
  }

  return null;
};

export const tenantPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(createTenantPlugin({
    tenantManager,
    extractTenantId,
    excludePaths: ['/health', '/api/health'],
  }));
});

export default tenantPlugin;
`
      : `const fp = require('fastify-plugin');
const { createTenantPlugin } = require('drizzle-multitenant/fastify');
const { tenantManager } = require('../db/index.js');

const extractTenantId = (req) => {
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant) {
    return headerTenant;
  }

  const host = req.hostname;
  const subdomain = host.split('.')[0];
  if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
    return subdomain;
  }

  return null;
};

const tenantPlugin = fp(async (fastify) => {
  await fastify.register(createTenantPlugin({
    tenantManager,
    extractTenantId,
    excludePaths: ['/health', '/api/health'],
  }));
});

module.exports = tenantPlugin;
`,
  });

  files.push({
    path: `src/app.${ext}`,
    content: answers.useTypeScript
      ? `import Fastify from 'fastify';
import tenantPlugin from './plugins/tenant.js';
import { getTenantDb, getTenantId } from './db/index.js';

const app = Fastify({ logger: true });

// Register tenant plugin
app.register(tenantPlugin);

// Health check
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Example tenant-scoped route
app.get('/api/users', async (request, reply) => {
  const db = getTenantDb();
  const tenantId = getTenantId();
  const users = await db.query.users.findMany();
  return { tenantId, users };
});

export default app;
`
      : `const Fastify = require('fastify');
const tenantPlugin = require('./plugins/tenant.js');
const { getTenantDb, getTenantId } = require('./db/index.js');

const app = Fastify({ logger: true });

app.register(tenantPlugin);

app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

app.get('/api/users', async (request, reply) => {
  const db = getTenantDb();
  const tenantId = getTenantId();
  const users = await db.query.users.findMany();
  return { tenantId, users };
});

module.exports = app;
`,
  });

  return files;
}

function generateNestJSFiles(answers: InitWizardAnswers): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  // Only TypeScript for NestJS
  files.push({
    path: 'src/tenant/tenant.module.ts',
    content: `import { Module, Global } from '@nestjs/common';
import { TenantModule as DrizzleTenantModule } from 'drizzle-multitenant/nestjs';
import config from '../../tenant.config.js';

@Global()
@Module({
  imports: [
    DrizzleTenantModule.forRoot({
      config,
      extractTenantId: (request) => {
        // From header
        const headerTenant = request.headers['x-tenant-id'];
        if (headerTenant) {
          return headerTenant as string;
        }

        // From subdomain
        const host = request.hostname || request.headers.host;
        if (host) {
          const subdomain = host.split('.')[0];
          if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
            return subdomain;
          }
        }

        return null;
      },
    }),
  ],
  exports: [DrizzleTenantModule],
})
export class TenantModule {}
`,
  });

  files.push({
    path: 'src/users/users.service.ts',
    content: `import { Injectable } from '@nestjs/common';
import { InjectTenantDb, InjectTenantContext } from 'drizzle-multitenant/nestjs';
import type { TenantDb, TenantContext } from 'drizzle-multitenant';
import { users } from '../db/schema/tenant/index.js';
import { eq } from 'drizzle-orm';

@Injectable()
export class UsersService {
  constructor(
    @InjectTenantDb() private readonly db: TenantDb,
    @InjectTenantContext() private readonly context: TenantContext,
  ) {}

  async findAll() {
    return this.db.select().from(users);
  }

  async findOne(id: string) {
    const result = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0] || null;
  }

  async create(data: { email: string; name?: string }) {
    const result = await this.db
      .insert(users)
      .values(data)
      .returning();
    return result[0];
  }

  getCurrentTenant() {
    return this.context.tenantId;
  }
}
`,
  });

  files.push({
    path: 'src/users/users.controller.ts',
    content: `import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { TenantGuard, RequiresTenant } from 'drizzle-multitenant/nestjs';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(TenantGuard)
@RequiresTenant()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll() {
    const users = await this.usersService.findAll();
    const tenantId = this.usersService.getCurrentTenant();
    return { tenantId, users };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  async create(@Body() data: { email: string; name?: string }) {
    return this.usersService.create(data);
  }
}
`,
  });

  files.push({
    path: 'src/users/users.module.ts',
    content: `import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
`,
  });

  files.push({
    path: 'src/app.module.ts',
    content: `import { Module } from '@nestjs/common';
import { TenantModule } from './tenant/tenant.module.js';
import { UsersModule } from './users/users.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [TenantModule, UsersModule, HealthModule],
})
export class AppModule {}
`,
  });

  files.push({
    path: 'src/health/health.module.ts',
    content: `import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
`,
  });

  files.push({
    path: 'src/health/health.controller.ts',
    content: `import { Controller, Get } from '@nestjs/common';
import { PublicRoute } from 'drizzle-multitenant/nestjs';

@Controller('health')
export class HealthController {
  @Get()
  @PublicRoute()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
`,
  });

  files.push({
    path: 'src/main.ts',
    content: `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(\`Application running on port \${port}\`);
}

bootstrap();
`,
  });

  return files;
}

function generateHonoFiles(answers: InitWizardAnswers): GeneratedFile[] {
  const ext = answers.useTypeScript ? 'ts' : 'js';
  const files: GeneratedFile[] = [];

  files.push({
    path: `src/middleware/tenant.${ext}`,
    content: answers.useTypeScript
      ? `import type { Context, Next } from 'hono';
import { tenantManager, runWithTenant } from '../db/index.js';

export const extractTenantId = (c: Context): string | null => {
  const headerTenant = c.req.header('x-tenant-id');
  if (headerTenant) {
    return headerTenant;
  }

  const url = new URL(c.req.url);
  const subdomain = url.hostname.split('.')[0];
  if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
    return subdomain;
  }

  return null;
};

export const tenantMiddleware = async (c: Context, next: Next) => {
  const tenantId = extractTenantId(c);

  if (!tenantId) {
    return c.json(
      { error: 'Tenant ID required', message: 'Please provide x-tenant-id header' },
      400
    );
  }

  try {
    return await runWithTenant(tenantId, () => next());
  } catch (error) {
    console.error('Tenant middleware error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
};

// Skip tenant middleware for these paths
export const publicPaths = ['/health', '/api/health'];

export const conditionalTenantMiddleware = async (c: Context, next: Next) => {
  const path = new URL(c.req.url).pathname;

  if (publicPaths.some(p => path.startsWith(p))) {
    return next();
  }

  return tenantMiddleware(c, next);
};
`
      : `const { runWithTenant } = require('../db/index.js');

const extractTenantId = (c) => {
  const headerTenant = c.req.header('x-tenant-id');
  if (headerTenant) {
    return headerTenant;
  }

  const url = new URL(c.req.url);
  const subdomain = url.hostname.split('.')[0];
  if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
    return subdomain;
  }

  return null;
};

const tenantMiddleware = async (c, next) => {
  const tenantId = extractTenantId(c);

  if (!tenantId) {
    return c.json(
      { error: 'Tenant ID required', message: 'Please provide x-tenant-id header' },
      400
    );
  }

  try {
    return await runWithTenant(tenantId, () => next());
  } catch (error) {
    console.error('Tenant middleware error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
};

const publicPaths = ['/health', '/api/health'];

const conditionalTenantMiddleware = async (c, next) => {
  const path = new URL(c.req.url).pathname;

  if (publicPaths.some(p => path.startsWith(p))) {
    return next();
  }

  return tenantMiddleware(c, next);
};

module.exports = {
  extractTenantId,
  tenantMiddleware,
  publicPaths,
  conditionalTenantMiddleware,
};
`,
  });

  files.push({
    path: `src/app.${ext}`,
    content: answers.useTypeScript
      ? `import { Hono } from 'hono';
import { conditionalTenantMiddleware } from './middleware/tenant.js';
import { getTenantDb, getTenantId } from './db/index.js';

const app = new Hono();

// Health check (public)
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply tenant middleware
app.use('*', conditionalTenantMiddleware);

// Example tenant-scoped route
app.get('/api/users', async (c) => {
  const db = getTenantDb();
  const tenantId = getTenantId();
  const users = await db.query.users.findMany();
  return c.json({ tenantId, users });
});

export default app;
`
      : `const { Hono } = require('hono');
const { conditionalTenantMiddleware } = require('./middleware/tenant.js');
const { getTenantDb, getTenantId } = require('./db/index.js');

const app = new Hono();

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('*', conditionalTenantMiddleware);

app.get('/api/users', async (c) => {
  const db = getTenantDb();
  const tenantId = getTenantId();
  const users = await db.query.users.findMany();
  return c.json({ tenantId, users });
});

module.exports = app;
`,
  });

  return files;
}
