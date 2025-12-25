import { sql, getTableName } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { SQL, Column, Table } from 'drizzle-orm';
import type {
  JoinCondition,
  JoinType,
  WithSharedConfig,
  WithSharedOptions,
  InferSelectResult,
} from './types.js';

/**
 * Extract tables from a Drizzle schema object
 */
function extractTablesFromSchema(schema: Record<string, unknown>): Set<Table> {
  const tables = new Set<Table>();

  for (const value of Object.values(schema)) {
    if (value && typeof value === 'object' && '_' in value) {
      const branded = value as { _?: { brand?: string } };
      if (branded._?.brand === 'Table') {
        tables.add(value as Table);
      }
    }
  }

  return tables;
}

/**
 * Check if a table belongs to the shared schema
 */
function isSharedTable(table: Table, sharedTables: Set<Table>): boolean {
  return sharedTables.has(table);
}

/**
 * Simplified cross-schema query builder with automatic schema detection
 *
 * @example
 * ```typescript
 * const result = await withShared(tenantDb, sharedDb, { tenant: tenantSchema, shared: sharedSchema })
 *   .from(pedidos)
 *   .leftJoin(workflowSteps, eq(pedidos.workflowStepId, workflowSteps.id))
 *   .select({ pedidoId: pedidos.id, workflowNome: workflowSteps.nome })
 *   .execute();
 * ```
 */
export class WithSharedQueryBuilder<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  private fromTable: {
    table: Table;
    isShared: boolean;
    schemaName: string;
  } | null = null;

  private joins: Array<{
    table: Table;
    isShared: boolean;
    schemaName: string;
    condition: JoinCondition;
    type: JoinType;
  }> = [];

  private selectFields: Record<string, Column> = {};
  private whereCondition: SQL<unknown> | null = null;
  private orderByFields: SQL<unknown>[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;

  constructor(
    private readonly tenantDb: NodePgDatabase<TTenantSchema>,
    private readonly sharedTables: Set<Table>,
    private readonly tenantSchemaName: string,
    private readonly sharedSchemaName: string = 'public'
  ) {}

  /**
   * Set the main table to query from
   * Automatically detects if it's a tenant or shared table
   */
  from<T extends Table>(table: T): this {
    const isShared = isSharedTable(table, this.sharedTables);
    this.fromTable = {
      table,
      isShared,
      schemaName: isShared ? this.sharedSchemaName : this.tenantSchemaName,
    };
    return this;
  }

  /**
   * Add a left join with automatic schema detection
   */
  leftJoin<T extends Table>(table: T, condition: JoinCondition): this {
    return this.addJoin(table, condition, 'left');
  }

  /**
   * Add an inner join with automatic schema detection
   */
  innerJoin<T extends Table>(table: T, condition: JoinCondition): this {
    return this.addJoin(table, condition, 'inner');
  }

  /**
   * Add a right join with automatic schema detection
   */
  rightJoin<T extends Table>(table: T, condition: JoinCondition): this {
    return this.addJoin(table, condition, 'right');
  }

  /**
   * Add a full outer join with automatic schema detection
   */
  fullJoin<T extends Table>(table: T, condition: JoinCondition): this {
    return this.addJoin(table, condition, 'full');
  }

  /**
   * Select specific fields
   */
  select<T extends Record<string, Column>>(fields: T): this {
    this.selectFields = fields;
    return this;
  }

  /**
   * Add a WHERE condition
   */
  where(condition: SQL<unknown>): this {
    this.whereCondition = condition;
    return this;
  }

  /**
   * Add ORDER BY
   */
  orderBy(...fields: SQL<unknown>[]): this {
    this.orderByFields = fields;
    return this;
  }

  /**
   * Set LIMIT
   */
  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  /**
   * Set OFFSET
   */
  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }

  /**
   * Execute the query and return typed results
   */
  async execute<TResult extends Record<string, unknown> = InferSelectResult<typeof this.selectFields>>(): Promise<TResult[]> {
    if (!this.fromTable) {
      throw new Error('[drizzle-multitenant] No table specified. Use .from() first.');
    }

    const sqlQuery = this.buildSql();
    const result = await this.tenantDb.execute(sqlQuery);

    return result.rows as TResult[];
  }

  /**
   * Add a join to the query
   */
  private addJoin<T extends Table>(
    table: T,
    condition: JoinCondition,
    type: JoinType
  ): this {
    const isShared = isSharedTable(table, this.sharedTables);
    this.joins.push({
      table,
      isShared,
      schemaName: isShared ? this.sharedSchemaName : this.tenantSchemaName,
      condition,
      type,
    });
    return this;
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
      // Try to get table name from column
      const tableName = this.getTableAliasForColumn(column);
      if (tableName) {
        return sql`${sql.raw(`"${tableName}"."${columnName}"`)} as ${sql.raw(`"${alias}"`)}`;
      }
      return sql`${sql.raw(`"${columnName}"`)} as ${sql.raw(`"${alias}"`)}`;
    });

    if (selectParts.length === 0) {
      parts.push(sql`SELECT *`);
    } else {
      parts.push(sql`SELECT ${sql.join(selectParts, sql`, `)}`);
    }

    // FROM clause with alias
    const fromTableName = getTableName(this.fromTable.table);
    const fromTableRef = `"${this.fromTable.schemaName}"."${fromTableName}"`;
    parts.push(sql` FROM ${sql.raw(fromTableRef)} "${sql.raw(fromTableName)}"`);

    // JOIN clauses with aliases
    for (const join of this.joins) {
      const joinTableName = getTableName(join.table);
      const joinTableRef = `"${join.schemaName}"."${joinTableName}"`;
      const joinKeyword = this.getJoinKeyword(join.type);
      parts.push(
        sql` ${sql.raw(joinKeyword)} ${sql.raw(joinTableRef)} "${sql.raw(joinTableName)}" ON ${join.condition}`
      );
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
   * Get table alias for a column (used in SELECT)
   */
  private getTableAliasForColumn(column: Column): string | null {
    // Drizzle columns have a reference to their table
    const columnTable = (column as unknown as { table?: Table }).table;
    if (columnTable) {
      return getTableName(columnTable);
    }
    return null;
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
 * Create a simplified cross-schema query builder with automatic schema detection
 *
 * This helper automatically detects whether a table belongs to the tenant schema
 * or the shared schema based on the schema configuration provided.
 *
 * @param tenantDb - The tenant database instance
 * @param sharedDb - The shared database instance (unused but kept for API symmetry)
 * @param schemas - Object containing tenant and shared schema definitions
 * @param options - Optional configuration for schema names
 * @returns A query builder with automatic schema detection
 *
 * @example
 * ```typescript
 * // Define your schemas
 * const tenantSchema = { pedidos, clientes };
 * const sharedSchema = { workflowSteps, plans };
 *
 * // Use withShared for cross-schema queries
 * const result = await withShared(
 *   tenantDb,
 *   sharedDb,
 *   { tenant: tenantSchema, shared: sharedSchema }
 * )
 *   .from(pedidos)                    // Auto-detected as tenant table
 *   .leftJoin(workflowSteps,          // Auto-detected as shared table
 *     eq(pedidos.workflowStepId, workflowSteps.id)
 *   )
 *   .select({
 *     pedidoId: pedidos.id,
 *     workflowNome: workflowSteps.nome,
 *   })
 *   .where(eq(pedidos.status, 'active'))
 *   .orderBy(desc(pedidos.createdAt))
 *   .limit(10)
 *   .execute();
 * ```
 */
export function withShared<
  TTenantSchema extends Record<string, unknown>,
  TSharedSchema extends Record<string, unknown>,
>(
  tenantDb: NodePgDatabase<TTenantSchema>,
  _sharedDb: NodePgDatabase<TSharedSchema>,
  schemas: WithSharedConfig<TTenantSchema, TSharedSchema>,
  options?: WithSharedOptions
): WithSharedQueryBuilder<TTenantSchema, TSharedSchema> {
  const sharedTables = extractTablesFromSchema(schemas.shared);

  return new WithSharedQueryBuilder(
    tenantDb,
    sharedTables,
    options?.tenantSchema ?? 'tenant',
    options?.sharedSchema ?? 'public'
  );
}
