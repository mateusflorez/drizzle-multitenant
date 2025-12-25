import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { SQL, Column, Table } from 'drizzle-orm';

/**
 * Schema source identifier
 */
export type SchemaSource = 'tenant' | 'shared';

/**
 * Cross-schema query context
 */
export interface CrossSchemaContext<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  tenantDb: NodePgDatabase<TTenantSchema>;
  sharedDb: NodePgDatabase<TSharedSchema>;
  tenantSchema?: string;
  sharedSchema?: string;
}

/**
 * Join condition type
 */
export type JoinCondition = SQL<unknown>;

/**
 * Join type
 */
export type JoinType = 'inner' | 'left' | 'right' | 'full';

/**
 * Table reference with schema
 */
export interface TableReference<T extends Table = Table> {
  table: T;
  source: SchemaSource;
  alias?: string;
}

/**
 * Join definition
 */
export interface JoinDefinition<T extends Table = Table> {
  table: T;
  source: SchemaSource;
  condition: JoinCondition;
  type: JoinType;
  alias?: string;
}

/**
 * Select field definition
 */
export interface SelectField<TColumn extends Column = Column> {
  column: TColumn;
  alias?: string;
}

/**
 * Cross-schema query builder state
 */
export interface QueryBuilderState<
  TFrom extends Table = Table,
  TSelect extends Record<string, Column> = Record<string, Column>,
> {
  from: TableReference<TFrom>;
  joins: JoinDefinition[];
  select: TSelect;
  where?: SQL<unknown>;
  orderBy?: SQL<unknown>[];
  limit?: number;
  offset?: number;
}

/**
 * Lookup configuration for withSharedLookup
 */
export interface SharedLookupConfig<
  TTenantTable extends Table,
  TSharedTable extends Table,
  TSharedFields extends keyof TSharedTable['_']['columns'],
> {
  tenantDb: NodePgDatabase<Record<string, unknown>>;
  sharedDb: NodePgDatabase<Record<string, unknown>>;
  tenantTable: TTenantTable;
  sharedTable: TSharedTable;
  foreignKey: keyof TTenantTable['_']['columns'];
  sharedKey?: keyof TSharedTable['_']['columns'];
  sharedFields: TSharedFields[];
  where?: SQL<unknown>;
}

/**
 * Infer result type from lookup config
 */
export type LookupResult<
  TTenantTable extends Table,
  TSharedTable extends Table,
  TSharedFields extends keyof TSharedTable['_']['columns'],
> = {
  [K in keyof TTenantTable['_']['columns']]: TTenantTable['_']['columns'][K]['_']['data'];
} & {
  [K in TSharedFields]?: TSharedTable['_']['columns'][K]['_']['data'];
};

/**
 * Raw cross-schema query options
 */
export interface CrossSchemaRawOptions {
  tenantSchema: string;
  sharedSchema: string;
  sql: string;
  params?: unknown[];
}

/**
 * Column selection helper type
 */
export type ColumnSelection<T extends Table> = {
  [K in keyof T['_']['columns']]?: boolean;
};

/**
 * Infer selected columns type
 */
export type InferSelectedColumns<
  T extends Table,
  TSelection extends ColumnSelection<T>,
> = {
  [K in keyof TSelection as TSelection[K] extends true ? K : never]: T['_']['columns'][K extends keyof T['_']['columns'] ? K : never]['_']['data'];
};

/**
 * Configuration for withShared helper
 */
export interface WithSharedConfig<
  TTenantSchema extends Record<string, unknown> = Record<string, unknown>,
  TSharedSchema extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Tenant schema object containing table definitions */
  tenant: TTenantSchema;
  /** Shared schema object containing table definitions */
  shared: TSharedSchema;
}

/**
 * Options for withShared helper
 */
export interface WithSharedOptions {
  /** Tenant schema name (default: derived from tenantDb) */
  tenantSchema?: string;
  /** Shared schema name (default: 'public') */
  sharedSchema?: string;
}

/**
 * Infer result type from select fields
 */
export type InferSelectResult<T extends Record<string, Column>> = {
  [K in keyof T]: T[K]['_']['data'];
};
