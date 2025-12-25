/**
 * drizzle-multitenant configuration for NestJS
 */
import { defineConfig } from "drizzle-multitenant";
import * as schema from "./schema";

export const tenantConfig = defineConfig({
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
      console.log(`[TenantModule] Pool created: ${tenantId}`);
    },
    onPoolEvicted: (tenantId) => {
      console.log(`[TenantModule] Pool evicted: ${tenantId}`);
    },
  },
  debug: {
    enabled: process.env.NODE_ENV === "development",
    logQueries: true,
    logPoolEvents: true,
  },
});

export { schema };
