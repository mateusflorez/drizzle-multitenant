import { sql, getTableName } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { SQL, Table, Column } from 'drizzle-orm';
import type {
  CrossSchemaContext,
  SchemaSource,
  JoinType,
  JoinCondition,
  SharedLookupConfig,
  CrossSchemaRawOptions,
} from './types.js';

/**
 * Cross-schema query builder for joining tenant and shared data
 *
 * @example
 * ```typescript
 * const query = createCrossSchemaQuery({
 *   tenantDb: tenants.getDb('tenant-uuid'),
 *   sharedDb: tenants.getSharedDb(),
 * });
 *
 * const results = await query
 *   .from('tenant', orders)
 *   .leftJoin('shared', subscriptionPlans, eq(orders.planId, subscriptionPlans.id))
 *   .select({
 *     orderId: orders.id,
 *     planName: subscriptionPlans.name,
 *   })
 *   .execute();
 * ```
 */
export class CrossSchemaQueryBuilder<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  private fromTable: { table: Table; source: SchemaSource; schemaName: string } | null = null;
  private joins: Array<{
    table: Table;
    source: SchemaSource;
    schemaName: string;
    condition: JoinCondition;
    type: JoinType;
  }> = [];
  private selectFields: Record<string, Column> = {};
  private whereCondition: SQL<unknown> | null = null;
  private orderByFields: SQL<unknown>[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;

  constructor(private readonly context: CrossSchemaContext<TTenantSchema, TSharedSchema>) {}

  /**
   * Set the main table to query from
   */
  from<T extends Table>(source: SchemaSource, table: T): this {
    const schemaName = this.getSchemaName(source);
    this.fromTable = { table, source, schemaName };
    return this;
  }

  /**
   * Add an inner join
   */
  innerJoin<T extends Table>(source: SchemaSource, table: T, condition: JoinCondition): this {
    return this.addJoin(source, table, condition, 'inner');
  }

  /**
   * Add a left join
   */
  leftJoin<T extends Table>(source: SchemaSource, table: T, condition: JoinCondition): this {
    return this.addJoin(source, table, condition, 'left');
  }

  /**
   * Add a right join
   */
  rightJoin<T extends Table>(source: SchemaSource, table: T, condition: JoinCondition): this {
    return this.addJoin(source, table, condition, 'right');
  }

  /**
   * Add a full outer join
   */
  fullJoin<T extends Table>(source: SchemaSource, table: T, condition: JoinCondition): this {
    return this.addJoin(source, table, condition, 'full');
  }

  /**
   * Select specific fields
   */
  select<T extends Record<string, Column>>(fields: T): this {
    this.selectFields = fields;
    return this;
  }

  /**
   * Add a where condition
   */
  where(condition: SQL<unknown>): this {
    this.whereCondition = condition;
    return this;
  }

  /**
   * Add order by
   */
  orderBy(...fields: SQL<unknown>[]): this {
    this.orderByFields = fields;
    return this;
  }

  /**
   * Set limit
   */
  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  /**
   * Set offset
   */
  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }

  /**
   * Execute the query and return typed results
   */
  async execute<TResult = Record<string, unknown>>(): Promise<TResult[]> {
    if (!this.fromTable) {
      throw new Error('[drizzle-multitenant] No table specified. Use .from() first.');
    }

    const sqlQuery = this.buildSql();

    // Use the tenant db to execute (it has access to both schemas via search_path)
    const result = await this.context.tenantDb.execute(sqlQuery);

    return result.rows as TResult[];
  }

  /**
   * Build the SQL query
   */
  private buildSql(): SQL<unknown> {
    if (!this.fromTable) {
      throw new Error('[drizzle-multitenant] No table specified');
    }

    const parts: SQL<unknown>[] = [];

    // SELECT clause
    const selectParts = Object.entries(this.selectFields).map(([alias, column]) => {
      const columnName = column.name;
      return sql`${sql.raw(`"${columnName}"`)} as ${sql.raw(`"${alias}"`)}`;
    });

    if (selectParts.length === 0) {
      parts.push(sql`SELECT *`);
    } else {
      parts.push(sql`SELECT ${sql.join(selectParts, sql`, `)}`);
    }

    // FROM clause
    const fromTableRef = this.getFullTableName(this.fromTable.schemaName, this.fromTable.table);
    parts.push(sql` FROM ${sql.raw(fromTableRef)}`);

    // JOIN clauses
    for (const join of this.joins) {
      const joinTableRef = this.getFullTableName(join.schemaName, join.table);
      const joinType = this.getJoinKeyword(join.type);
      parts.push(sql` ${sql.raw(joinType)} ${sql.raw(joinTableRef)} ON ${join.condition}`);
    }

    // WHERE clause
    if (this.whereCondition) {
      parts.push(sql` WHERE ${this.whereCondition}`);
    }

    // ORDER BY clause
    if (this.orderByFields.length > 0) {
      parts.push(sql` ORDER BY ${sql.join(this.orderByFields, sql`, `)}`);
    }

    // LIMIT clause
    if (this.limitValue !== null) {
      parts.push(sql` LIMIT ${sql.raw(this.limitValue.toString())}`);
    }

    // OFFSET clause
    if (this.offsetValue !== null) {
      parts.push(sql` OFFSET ${sql.raw(this.offsetValue.toString())}`);
    }

    return sql.join(parts, sql``);
  }

  /**
   * Add a join to the query
   */
  private addJoin<T extends Table>(
    source: SchemaSource,
    table: T,
    condition: JoinCondition,
    type: JoinType
  ): this {
    const schemaName = this.getSchemaName(source);
    this.joins.push({ table, source, schemaName, condition, type });
    return this;
  }

  /**
   * Get schema name for a source
   */
  private getSchemaName(source: SchemaSource): string {
    if (source === 'tenant') {
      return this.context.tenantSchema ?? 'tenant';
    }
    return this.context.sharedSchema ?? 'public';
  }

  /**
   * Get fully qualified table name
   */
  private getFullTableName(schemaName: string, table: Table): string {
    const tableName = getTableName(table);
    return `"${schemaName}"."${tableName}"`;
  }

  /**
   * Get SQL keyword for join type
   */
  private getJoinKeyword(type: JoinType): string {
    switch (type) {
      case 'inner':
        return 'INNER JOIN';
      case 'left':
        return 'LEFT JOIN';
      case 'right':
        return 'RIGHT JOIN';
      case 'full':
        return 'FULL OUTER JOIN';
    }
  }
}

/**
 * Create a cross-schema query builder
 */
export function createCrossSchemaQuery<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
>(
  context: CrossSchemaContext<TTenantSchema, TSharedSchema>
): CrossSchemaQueryBuilder<TTenantSchema, TSharedSchema> {
  return new CrossSchemaQueryBuilder(context);
}

/**
 * Helper for common pattern: tenant table with shared lookup
 *
 * @example
 * ```typescript
 * const ordersWithPlans = await withSharedLookup({
 *   tenantDb,
 *   sharedDb,
 *   tenantTable: orders,
 *   sharedTable: subscriptionPlans,
 *   foreignKey: 'planId',
 *   sharedFields: ['name', 'features', 'price'],
 * });
 * ```
 */
export async function withSharedLookup<
  TTenantTable extends Table,
  TSharedTable extends Table,
  TSharedFields extends keyof TSharedTable['_']['columns'],
>(config: SharedLookupConfig<TTenantTable, TSharedTable, TSharedFields>): Promise<Array<Record<string, unknown>>> {
  const {
    tenantDb,
    tenantTable,
    sharedTable,
    foreignKey,
    sharedKey = 'id' as keyof TSharedTable['_']['columns'],
    sharedFields,
    where: whereCondition,
  } = config;

  // Get table names using Drizzle's utility
  const tenantTableName = getTableName(tenantTable);
  const sharedTableName = getTableName(sharedTable);

  // Build field list for shared table
  const sharedFieldList = sharedFields
    .map((field) => `s."${String(field)}"`)
    .join(', ');

  // Build the query
  const queryParts = [
    `SELECT t.*, ${sharedFieldList}`,
    `FROM "${tenantTableName}" t`,
    `LEFT JOIN "public"."${sharedTableName}" s ON t."${String(foreignKey)}" = s."${String(sharedKey)}"`,
  ];

  if (whereCondition) {
    queryParts.push('WHERE');
    // We'll need to use raw SQL for the where condition
  }

  const sqlQuery = sql.raw(queryParts.join(' '));

  const result = await tenantDb.execute(sqlQuery);

  return result.rows as Array<Record<string, unknown>>;
}

/**
 * Execute raw cross-schema SQL with type safety
 *
 * @example
 * ```typescript
 * const result = await crossSchemaRaw<{ userName: string; planName: string }>({
 *   tenantSchema: 'tenant_abc123',
 *   sharedSchema: 'public',
 *   sql: `
 *     SELECT u.name as "userName", p.name as "planName"
 *     FROM $tenant.users u
 *     JOIN $shared.plans p ON u.plan_id = p.id
 *   `,
 * });
 * ```
 */
export async function crossSchemaRaw<TResult = Record<string, unknown>>(
  db: NodePgDatabase<Record<string, unknown>>,
  options: CrossSchemaRawOptions
): Promise<TResult[]> {
  const { tenantSchema, sharedSchema, sql: rawSql } = options;

  // Replace $tenant and $shared placeholders
  const processedSql = rawSql
    .replace(/\$tenant\./g, `"${tenantSchema}".`)
    .replace(/\$shared\./g, `"${sharedSchema}".`);

  const query = sql.raw(processedSql);

  const result = await db.execute(query);

  return result.rows as TResult[];
}

/**
 * Create a typed cross-schema query using SQL template
 *
 * @example
 * ```typescript
 * const users = await crossSchemaSelect(tenantDb, {
 *   tenantSchema: 'tenant_abc',
 *   sharedSchema: 'public',
 *   select: {
 *     id: users.id,
 *     name: users.name,
 *     planName: plans.name,
 *   },
 *   from: { table: users, schema: 'tenant' },
 *   joins: [
 *     { table: plans, schema: 'shared', on: eq(users.planId, plans.id), type: 'left' },
 *   ],
 * });
 * ```
 */
export function buildCrossSchemaSelect<T extends Record<string, Column>>(
  fields: T,
  tenantSchema: string,
  _sharedSchema: string
): { columns: string[]; getSchema: () => string } {
  const columns = Object.entries(fields).map(([alias, column]) => {
    const columnName = column.name;
    return `"${columnName}" as "${alias}"`;
  });

  const getSchema = (): string => {
    // This would need more context to determine which schema a column belongs to
    // For now, return tenant schema as default
    return tenantSchema;
  };

  return { columns, getSchema };
}
