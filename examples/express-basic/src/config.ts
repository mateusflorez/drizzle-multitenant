/**
 * drizzle-multitenant configuration
 */
import { defineConfig } from "drizzle-multitenant";
import * as schema from "./schema.js";

export const config = defineConfig({
  connection: {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/multitenant",
    pooling: {
      max: 10,
      idleTimeoutMillis: 30000,
    },
    // Enable retry with exponential backoff
    retry: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitter: true,
      onRetry: (attempt, error, delay) => {
        console.log(`[Retry] Attempt ${attempt}, waiting ${delay}ms: ${error.message}`);
      },
    },
  },
  isolation: {
    strategy: "schema",
    schemaNameTemplate: (tenantId) => `tenant_${tenantId}`,
    maxPools: 50,
    poolTtlMs: 60 * 60 * 1000, // 1 hour
  },
  schemas: {
    tenant: schema,
    shared: schema,
  },
  hooks: {
    onPoolCreated: (tenantId) => {
      console.log(`[Pool] Created for tenant: ${tenantId}`);
    },
    onPoolEvicted: (tenantId) => {
      console.log(`[Pool] Evicted for tenant: ${tenantId}`);
    },
  },
  // Enable debug logging in development
  debug: {
    enabled: process.env.NODE_ENV === "development",
    logQueries: true,
    logPoolEvents: true,
  },
});

export { schema };
