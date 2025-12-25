/**
 * drizzle-multitenant configuration for Fastify
 */
import { defineConfig } from "drizzle-multitenant";
import * as schema from "./schema.js";

export const config = defineConfig({
  connection: {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/multitenant",
    pooling: {
      max: 20,
      idleTimeoutMillis: 30000,
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
    },
  },
  isolation: {
    strategy: "schema",
    schemaNameTemplate: (tenantId) => `tenant_${tenantId}`,
    maxPools: 100,
    poolTtlMs: 60 * 60 * 1000,
  },
  schemas: {
    tenant: schema,
    shared: schema,
  },
  hooks: {
    onPoolCreated: (tenantId) => {
      console.log(`[Pool] Created: ${tenantId}`);
    },
  },
  debug: {
    enabled: process.env.NODE_ENV === "development",
    logQueries: true,
    logPoolEvents: true,
  },
});

export { schema };
