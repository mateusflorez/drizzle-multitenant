# Cross-Schema Queries

Join tenant and shared tables with type safety.

## When to Use

| Approach | Use When |
|----------|----------|
| `withShared()` | Default choice. Automatic schema detection, less boilerplate |
| `createCrossSchemaQuery()` | Need explicit control over schema names, dynamic schemas |

### Common Use Cases

- **E-commerce**: Join tenant orders with shared product catalog
- **SaaS Billing**: Join tenant usage with shared pricing plans
- **Workflows**: Join tenant tasks with shared workflow definitions
- **Multi-region**: Join tenant data with shared configuration

## withShared() - Recommended

Automatic schema detection based on your configuration:

```typescript
import { withShared } from 'drizzle-multitenant';
import { eq } from 'drizzle-orm';
import * as tenantSchema from './schemas/tenant';   // { orders, customers }
import * as sharedSchema from './schemas/shared';   // { plans, workflowSteps }

const tenantDb = tenants.getDb('tenant-123');
const sharedDb = tenants.getSharedDb();

const result = await withShared(tenantDb, sharedDb, {
  tenant: tenantSchema,
  shared: sharedSchema,
})
  .from(orders)                    // Auto-detected as tenant table
  .leftJoin(plans,                 // Auto-detected as shared table
    eq(orders.planId, plans.id)
  )
  .innerJoin(customers,            // Auto-detected as tenant table
    eq(orders.customerId, customers.id)
  )
  .select({
    orderId: orders.id,
    customerName: customers.name,
    planName: plans.name,
    planPrice: plans.price,
  })
  .where(eq(orders.status, 'active'))
  .limit(50)
  .execute();
```

### Features

- Automatic detection of tenant vs shared tables
- All join types: `leftJoin`, `innerJoin`, `rightJoin`, `fullJoin`
- Full query builder: `where`, `orderBy`, `limit`, `offset`
- Type-safe results inferred from select fields

## createCrossSchemaQuery() - Manual Control

For explicit schema control:

```typescript
import { createCrossSchemaQuery } from 'drizzle-multitenant';

const query = createCrossSchemaQuery({
  tenantDb: tenants.getDb('tenant-123'),
  sharedDb: tenants.getSharedDb(),
  tenantSchema: 'tenant_123',
  sharedSchema: 'public',
});

const result = await query
  .from('tenant', orders)
  .leftJoin('shared', plans, eq(orders.planId, plans.id))
  .select({
    orderId: orders.id,
    planName: plans.name,
  })
  .execute();
```

## Complex Example

```typescript
const salesReport = await withShared(tenantDb, sharedDb, {
  tenant: tenantSchema,
  shared: sharedSchema,
})
  .from(orders)
  .innerJoin(customers, eq(orders.customerId, customers.id))
  .innerJoin(plans, eq(orders.planId, plans.id))
  .leftJoin(workflowSteps, eq(orders.currentStep, workflowSteps.id))
  .select({
    orderId: orders.id,
    orderDate: orders.createdAt,
    customerName: customers.name,
    customerEmail: customers.email,
    planName: plans.name,
    planPrice: plans.price,
    currentStep: workflowSteps.name,
  })
  .where(
    and(
      eq(orders.status, 'completed'),
      gte(orders.createdAt, startDate),
      lte(orders.createdAt, endDate)
    )
  )
  .orderBy(desc(orders.createdAt))
  .limit(100)
  .execute();
```
