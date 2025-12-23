import { describe, it, expect } from 'vitest';
import { defineConfig } from './config.js';

describe('defineConfig', () => {
  const validConfig = {
    connection: {
      url: 'postgresql://localhost:5432/test',
    },
    isolation: {
      strategy: 'schema' as const,
      schemaNameTemplate: (id: string) => `tenant_${id}`,
    },
    schemas: {
      tenant: { users: {} },
    },
  };

  it('should return the config when valid', () => {
    const config = defineConfig(validConfig);
    expect(config).toEqual(validConfig);
  });

  it('should accept optional shared schema', () => {
    const config = defineConfig({
      ...validConfig,
      schemas: {
        tenant: { users: {} },
        shared: { plans: {} },
      },
    });
    expect(config.schemas.shared).toEqual({ plans: {} });
  });

  it('should accept optional hooks', () => {
    const onPoolCreated = () => {};
    const config = defineConfig({
      ...validConfig,
      hooks: { onPoolCreated },
    });
    expect(config.hooks?.onPoolCreated).toBe(onPoolCreated);
  });

  it('should accept optional pool config', () => {
    const config = defineConfig({
      ...validConfig,
      connection: {
        url: 'postgresql://localhost:5432/test',
        poolConfig: {
          max: 20,
          idleTimeoutMillis: 60000,
        },
      },
    });
    expect(config.connection.poolConfig?.max).toBe(20);
  });

  it('should accept optional isolation limits', () => {
    const config = defineConfig({
      ...validConfig,
      isolation: {
        ...validConfig.isolation,
        maxPools: 100,
        poolTtlMs: 120000,
      },
    });
    expect(config.isolation.maxPools).toBe(100);
    expect(config.isolation.poolTtlMs).toBe(120000);
  });

  describe('validation errors', () => {
    it('should throw if connection.url is missing', () => {
      expect(() =>
        defineConfig({
          ...validConfig,
          connection: { url: '' },
        })
      ).toThrow('connection.url is required');
    });

    it('should throw if isolation.strategy is missing', () => {
      expect(() =>
        defineConfig({
          ...validConfig,
          isolation: {
            strategy: '' as 'schema',
            schemaNameTemplate: (id) => id,
          },
        })
      ).toThrow('isolation.strategy is required');
    });

    it('should throw if isolation.strategy is not schema', () => {
      expect(() =>
        defineConfig({
          ...validConfig,
          isolation: {
            strategy: 'database' as 'schema',
            schemaNameTemplate: (id) => id,
          },
        })
      ).toThrow('not yet supported');
    });

    it('should throw if schemaNameTemplate is missing', () => {
      expect(() =>
        defineConfig({
          ...validConfig,
          isolation: {
            strategy: 'schema',
            schemaNameTemplate: undefined as unknown as (id: string) => string,
          },
        })
      ).toThrow('schemaNameTemplate is required');
    });

    it('should throw if schemaNameTemplate is not a function', () => {
      expect(() =>
        defineConfig({
          ...validConfig,
          isolation: {
            strategy: 'schema',
            schemaNameTemplate: 'not-a-function' as unknown as (id: string) => string,
          },
        })
      ).toThrow('schemaNameTemplate must be a function');
    });

    it('should throw if schemas.tenant is missing', () => {
      expect(() =>
        defineConfig({
          ...validConfig,
          schemas: { tenant: undefined as unknown as Record<string, unknown> },
        })
      ).toThrow('schemas.tenant is required');
    });

    it('should throw if maxPools is less than 1', () => {
      expect(() =>
        defineConfig({
          ...validConfig,
          isolation: {
            ...validConfig.isolation,
            maxPools: 0,
          },
        })
      ).toThrow('maxPools must be at least 1');
    });

    it('should throw if poolTtlMs is negative', () => {
      expect(() =>
        defineConfig({
          ...validConfig,
          isolation: {
            ...validConfig.isolation,
            poolTtlMs: -1,
          },
        })
      ).toThrow('poolTtlMs must be non-negative');
    });
  });

  describe('schemaNameTemplate', () => {
    it('should transform tenant id correctly', () => {
      const config = defineConfig({
        ...validConfig,
        isolation: {
          strategy: 'schema',
          schemaNameTemplate: (id) => `tenant_${id.replace(/-/g, '_')}`,
        },
      });

      expect(config.isolation.schemaNameTemplate('abc-123-def')).toBe('tenant_abc_123_def');
    });
  });
});
