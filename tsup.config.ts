import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/integrations/express.ts',
    'src/integrations/fastify.ts',
    'src/integrations/nestjs/index.ts',
    'src/integrations/hono.ts',
    'src/migrator/index.ts',
    'src/cross-schema/index.ts',
    'src/scaffold/index.ts',
    'src/cli/index.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    'drizzle-orm',
    'pg',
    '@nestjs/common',
    '@nestjs/core',
    'express',
    'fastify',
    'hono',
  ],
});
