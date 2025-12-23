import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql, eq, getTableName } from 'drizzle-orm';
import { pgTable, serial, varchar, integer, text } from 'drizzle-orm/pg-core';
import {
  createCrossSchemaQuery,
  withSharedLookup,
  crossSchemaRaw,
  buildCrossSchemaSelect,
} from './cross-schema.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// Mock tables for testing
const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }),
  planId: integer('plan_id'),
});

const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  total: integer('total'),
  status: varchar('status', { length: 50 }),
});

const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }),
  price: integer('price'),
  features: text('features'),
});

// Mock database
const createMockDb = () => {
  const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
  return {
    execute: mockExecute,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    _mockExecute: mockExecute,
  } as unknown as NodePgDatabase<Record<string, unknown>> & { _mockExecute: ReturnType<typeof vi.fn> };
};

describe('CrossSchemaQueryBuilder', () => {
  let tenantDb: ReturnType<typeof createMockDb>;
  let sharedDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    tenantDb = createMockDb();
    sharedDb = createMockDb();
  });

  describe('createCrossSchemaQuery', () => {
    it('should create a query builder instance', () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      expect(query).toBeDefined();
      expect(typeof query.from).toBe('function');
      expect(typeof query.leftJoin).toBe('function');
      expect(typeof query.select).toBe('function');
    });

    it('should build a simple select query', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await query
        .from('tenant', users)
        .select({
          id: users.id,
          name: users.name,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should build a query with left join', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await query
        .from('tenant', users)
        .leftJoin('shared', plans, eq(users.planId, plans.id))
        .select({
          userName: users.name,
          planName: plans.name,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should build a query with inner join', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await query
        .from('tenant', orders)
        .innerJoin('tenant', users, eq(orders.userId, users.id))
        .select({
          orderId: orders.id,
          userName: users.name,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should build a query with where condition', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await query
        .from('tenant', orders)
        .where(eq(orders.status, 'active'))
        .select({
          id: orders.id,
          total: orders.total,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should build a query with limit and offset', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await query
        .from('tenant', users)
        .select({
          id: users.id,
          name: users.name,
        })
        .limit(10)
        .offset(20)
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should throw error when executing without from', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await expect(query.execute()).rejects.toThrow('No table specified');
    });

    it('should support multiple joins', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await query
        .from('tenant', orders)
        .leftJoin('tenant', users, eq(orders.userId, users.id))
        .leftJoin('shared', plans, eq(users.planId, plans.id))
        .select({
          orderId: orders.id,
          userName: users.name,
          planName: plans.name,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should support right join', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await query
        .from('shared', plans)
        .rightJoin('tenant', users, eq(users.planId, plans.id))
        .select({
          planName: plans.name,
          userName: users.name,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should support full join', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      await query
        .from('tenant', users)
        .fullJoin('shared', plans, eq(users.planId, plans.id))
        .select({
          userName: users.name,
          planName: plans.name,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('getTableName utility', () => {
    it('should get correct table name for users', () => {
      expect(getTableName(users)).toBe('users');
    });

    it('should get correct table name for orders', () => {
      expect(getTableName(orders)).toBe('orders');
    });

    it('should get correct table name for plans', () => {
      expect(getTableName(plans)).toBe('plans');
    });
  });

  describe('withSharedLookup', () => {
    it('should perform a lookup from tenant to shared table', async () => {
      await withSharedLookup({
        tenantDb,
        sharedDb,
        tenantTable: users,
        sharedTable: plans,
        foreignKey: 'planId',
        sharedFields: ['name', 'price'],
      });

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should use custom shared key', async () => {
      await withSharedLookup({
        tenantDb,
        sharedDb,
        tenantTable: users,
        sharedTable: plans,
        foreignKey: 'planId',
        sharedKey: 'id',
        sharedFields: ['name', 'features'],
      });

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should include all specified shared fields', async () => {
      await withSharedLookup({
        tenantDb,
        sharedDb,
        tenantTable: users,
        sharedTable: plans,
        foreignKey: 'planId',
        sharedFields: ['name', 'price', 'features'],
      });

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('crossSchemaRaw', () => {
    it('should execute raw SQL with schema placeholders', async () => {
      await crossSchemaRaw(tenantDb, {
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
        sql: 'SELECT * FROM $tenant.users u JOIN $shared.plans p ON u.plan_id = p.id',
      });

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should replace multiple schema placeholders', async () => {
      await crossSchemaRaw(tenantDb, {
        tenantSchema: 'tenant_xyz',
        sharedSchema: 'public',
        sql: `
          SELECT $tenant.users.name, $shared.plans.name
          FROM $tenant.users
          JOIN $shared.plans ON $tenant.users.plan_id = $shared.plans.id
        `,
      });

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('buildCrossSchemaSelect', () => {
    it('should build column list for select', () => {
      const result = buildCrossSchemaSelect(
        {
          id: users.id,
          userName: users.name,
          planName: plans.name,
        },
        'tenant_abc',
        'public'
      );

      expect(result.columns).toHaveLength(3);
      expect(result.columns).toContain('"id" as "id"');
      expect(result.columns).toContain('"name" as "userName"');
      expect(result.columns).toContain('"name" as "planName"');
    });

    it('should return a getSchema function', () => {
      const result = buildCrossSchemaSelect(
        {
          userId: users.id,
        },
        'tenant_abc',
        'public'
      );

      expect(typeof result.getSchema).toBe('function');
      expect(result.getSchema()).toBe('tenant_abc');
    });
  });

  describe('chaining', () => {
    it('should support method chaining', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
        tenantSchema: 'tenant_abc',
        sharedSchema: 'public',
      });

      const result = query
        .from('tenant', users)
        .leftJoin('shared', plans, eq(users.planId, plans.id))
        .select({
          userName: users.name,
          planName: plans.name,
        })
        .where(eq(users.id, 1))
        .limit(10)
        .offset(0);

      expect(result).toBe(query);

      await result.execute();
      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('default schema names', () => {
    it('should use default schema names when not provided', async () => {
      const query = createCrossSchemaQuery({
        tenantDb,
        sharedDb,
      });

      await query
        .from('tenant', users)
        .select({ id: users.id })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });
});
