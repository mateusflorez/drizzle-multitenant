import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SharedSeeder, createSharedSeeder } from './shared-seeder.js';
import type { SharedSeederConfig, SharedSeederDependencies } from './types.js';

describe('SharedSeeder', () => {
  let sharedSeeder: SharedSeeder;
  let mockConfig: SharedSeederConfig;
  let mockDeps: SharedSeederDependencies;
  let mockPool: any;

  beforeEach(() => {
    mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    mockConfig = {
      schemaName: 'public',
    };

    mockDeps = {
      createPool: vi.fn().mockResolvedValue(mockPool),
      sharedSchema: {},
    };

    sharedSeeder = new SharedSeeder(mockConfig, mockDeps);
  });

  describe('seed', () => {
    it('should successfully seed shared schema', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      const result = await sharedSeeder.seed(seedFn);

      expect(result.success).toBe(true);
      expect(result.schemaName).toBe('public');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(seedFn).toHaveBeenCalledOnce();
    });

    it('should return error result when seed function throws', async () => {
      const seedFn = vi.fn().mockRejectedValue(new Error('Seed failed'));

      const result = await sharedSeeder.seed(seedFn);

      expect(result.success).toBe(false);
      expect(result.schemaName).toBe('public');
      expect(result.error).toBe('Seed failed');
    });

    it('should cleanup pool even on error', async () => {
      const seedFn = vi.fn().mockRejectedValue(new Error('Seed failed'));

      await sharedSeeder.seed(seedFn);

      expect(mockPool.end).toHaveBeenCalledOnce();
    });

    it('should cleanup pool on success', async () => {
      const seedFn = vi.fn().mockResolvedValue(undefined);

      await sharedSeeder.seed(seedFn);

      expect(mockPool.end).toHaveBeenCalledOnce();
    });

    it('should call onStart hook before seeding', async () => {
      const callOrder: string[] = [];
      const onStart = vi.fn(() => callOrder.push('onStart'));
      const configWithHooks: SharedSeederConfig = {
        schemaName: 'public',
        hooks: { onStart },
      };
      const seeder = new SharedSeeder(configWithHooks, mockDeps);
      const seedFn = vi.fn(() => {
        callOrder.push('seedFn');
        return Promise.resolve();
      });

      await seeder.seed(seedFn);

      expect(onStart).toHaveBeenCalledOnce();
      expect(callOrder).toEqual(['onStart', 'seedFn']);
    });

    it('should call onComplete hook after successful seeding', async () => {
      const onComplete = vi.fn();
      const configWithHooks: SharedSeederConfig = {
        schemaName: 'public',
        hooks: { onComplete },
      };
      const seeder = new SharedSeeder(configWithHooks, mockDeps);
      const seedFn = vi.fn().mockResolvedValue(undefined);

      await seeder.seed(seedFn);

      expect(onComplete).toHaveBeenCalledOnce();
    });

    it('should call onError hook when seeding fails', async () => {
      const error = new Error('Seed failed');
      const onError = vi.fn();
      const configWithHooks: SharedSeederConfig = {
        schemaName: 'public',
        hooks: { onError },
      };
      const seeder = new SharedSeeder(configWithHooks, mockDeps);
      const seedFn = vi.fn().mockRejectedValue(error);

      await seeder.seed(seedFn);

      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should use default schema name when not provided', async () => {
      const configWithoutSchema: SharedSeederConfig = {};
      const seeder = new SharedSeeder(configWithoutSchema, mockDeps);
      const seedFn = vi.fn().mockResolvedValue(undefined);

      const result = await seeder.seed(seedFn);

      expect(result.schemaName).toBe('public');
    });

    it('should use custom schema name when provided', async () => {
      const configWithCustomSchema: SharedSeederConfig = {
        schemaName: 'shared',
      };
      const seeder = new SharedSeeder(configWithCustomSchema, mockDeps);
      const seedFn = vi.fn().mockResolvedValue(undefined);

      const result = await seeder.seed(seedFn);

      expect(result.schemaName).toBe('shared');
    });
  });

  describe('createSharedSeeder', () => {
    it('should create a SharedSeeder instance', () => {
      const seeder = createSharedSeeder(mockConfig, mockDeps);

      expect(seeder).toBeInstanceOf(SharedSeeder);
    });
  });
});
