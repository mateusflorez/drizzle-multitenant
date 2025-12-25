import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { pgTable, serial, varchar, integer, text } from 'drizzle-orm/pg-core';
import { withShared, WithSharedQueryBuilder } from './with-shared.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// Tenant tables
const pedidos = pgTable('pedidos', {
  id: serial('id').primaryKey(),
  clienteId: integer('cliente_id'),
  workflowStepId: integer('workflow_step_id'),
  total: integer('total'),
  status: varchar('status', { length: 50 }),
});

const clientes = pgTable('clientes', {
  id: serial('id').primaryKey(),
  nome: varchar('nome', { length: 255 }),
  email: varchar('email', { length: 255 }),
});

// Shared tables
const workflowSteps = pgTable('workflow_steps', {
  id: serial('id').primaryKey(),
  nome: varchar('nome', { length: 255 }),
  ordem: integer('ordem'),
});

const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }),
  price: integer('price'),
  features: text('features'),
});

// Schema objects
const tenantSchema = { pedidos, clientes };
const sharedSchema = { workflowSteps, plans };

// Mock database
const createMockDb = () => {
  const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
  return {
    execute: mockExecute,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    _mockExecute: mockExecute,
  } as unknown as NodePgDatabase<Record<string, unknown>> & {
    _mockExecute: ReturnType<typeof vi.fn>;
  };
};

describe('withShared', () => {
  let tenantDb: ReturnType<typeof createMockDb>;
  let sharedDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    tenantDb = createMockDb();
    sharedDb = createMockDb();
  });

  describe('builder creation', () => {
    it('should create a query builder instance', () => {
      const builder = withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      });

      expect(builder).toBeInstanceOf(WithSharedQueryBuilder);
      expect(typeof builder.from).toBe('function');
      expect(typeof builder.leftJoin).toBe('function');
      expect(typeof builder.select).toBe('function');
      expect(typeof builder.execute).toBe('function');
    });
  });

  describe('automatic schema detection', () => {
    it('should detect tenant table in from()', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .select({
          id: pedidos.id,
          total: pedidos.total,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
      const sqlCall = tenantDb._mockExecute.mock.calls[0][0];
      expect(sqlCall).toBeDefined();
    });

    it('should detect shared table in from()', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(workflowSteps)
        .select({
          id: workflowSteps.id,
          nome: workflowSteps.nome,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should detect tenant table in join', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .innerJoin(clientes, eq(pedidos.clienteId, clientes.id))
        .select({
          pedidoId: pedidos.id,
          clienteNome: clientes.nome,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should detect shared table in join', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .leftJoin(workflowSteps, eq(pedidos.workflowStepId, workflowSteps.id))
        .select({
          pedidoId: pedidos.id,
          workflowNome: workflowSteps.nome,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('mixed schema queries', () => {
    it('should support multiple joins with mixed schemas', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .innerJoin(clientes, eq(pedidos.clienteId, clientes.id))
        .leftJoin(workflowSteps, eq(pedidos.workflowStepId, workflowSteps.id))
        .select({
          pedidoId: pedidos.id,
          clienteNome: clientes.nome,
          workflowNome: workflowSteps.nome,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should support tenant table joining to multiple shared tables', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(clientes)
        .leftJoin(workflowSteps, eq(clientes.id, workflowSteps.id))
        .leftJoin(plans, eq(clientes.id, plans.id))
        .select({
          clienteId: clientes.id,
          workflowNome: workflowSteps.nome,
          planName: plans.name,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('query building', () => {
    it('should support where condition', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .select({
          id: pedidos.id,
          total: pedidos.total,
        })
        .where(eq(pedidos.status, 'active'))
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should support limit and offset', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .select({
          id: pedidos.id,
        })
        .limit(10)
        .offset(20)
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should support select * when no fields specified', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('join types', () => {
    it('should support left join', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .leftJoin(workflowSteps, eq(pedidos.workflowStepId, workflowSteps.id))
        .select({
          pedidoId: pedidos.id,
          workflowNome: workflowSteps.nome,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should support inner join', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .innerJoin(clientes, eq(pedidos.clienteId, clientes.id))
        .select({
          pedidoId: pedidos.id,
          clienteNome: clientes.nome,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should support right join', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(workflowSteps)
        .rightJoin(pedidos, eq(pedidos.workflowStepId, workflowSteps.id))
        .select({
          workflowId: workflowSteps.id,
          pedidoId: pedidos.id,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });

    it('should support full join', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .fullJoin(workflowSteps, eq(pedidos.workflowStepId, workflowSteps.id))
        .select({
          pedidoId: pedidos.id,
          workflowNome: workflowSteps.nome,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when executing without from()', async () => {
      const builder = withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      });

      await expect(builder.execute()).rejects.toThrow('No table specified');
    });
  });

  describe('method chaining', () => {
    it('should return this for all chainable methods', () => {
      const builder = withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      });

      const fromResult = builder.from(pedidos);
      expect(fromResult).toBe(builder);

      const joinResult = fromResult.leftJoin(
        workflowSteps,
        eq(pedidos.workflowStepId, workflowSteps.id)
      );
      expect(joinResult).toBe(builder);

      const selectResult = joinResult.select({ id: pedidos.id });
      expect(selectResult).toBe(builder);

      const whereResult = selectResult.where(eq(pedidos.status, 'active'));
      expect(whereResult).toBe(builder);

      const limitResult = whereResult.limit(10);
      expect(limitResult).toBe(builder);

      const offsetResult = limitResult.offset(0);
      expect(offsetResult).toBe(builder);
    });
  });

  describe('options', () => {
    it('should accept custom schema names', async () => {
      await withShared(
        tenantDb,
        sharedDb,
        {
          tenant: tenantSchema,
          shared: sharedSchema,
        },
        {
          tenantSchema: 'tenant_custom',
          sharedSchema: 'shared_custom',
        }
      )
        .from(pedidos)
        .select({
          id: pedidos.id,
        })
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });

  describe('complex queries', () => {
    it('should handle complex query with all features', async () => {
      await withShared(tenantDb, sharedDb, {
        tenant: tenantSchema,
        shared: sharedSchema,
      })
        .from(pedidos)
        .innerJoin(clientes, eq(pedidos.clienteId, clientes.id))
        .leftJoin(workflowSteps, eq(pedidos.workflowStepId, workflowSteps.id))
        .leftJoin(plans, eq(clientes.id, plans.id))
        .select({
          pedidoId: pedidos.id,
          pedidoTotal: pedidos.total,
          clienteNome: clientes.nome,
          clienteEmail: clientes.email,
          workflowNome: workflowSteps.nome,
          planName: plans.name,
          planPrice: plans.price,
        })
        .where(eq(pedidos.status, 'active'))
        .limit(50)
        .offset(0)
        .execute();

      expect(tenantDb._mockExecute).toHaveBeenCalled();
    });
  });
});
