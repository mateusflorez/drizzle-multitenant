export {
  CrossSchemaQueryBuilder,
  createCrossSchemaQuery,
  withSharedLookup,
  crossSchemaRaw,
  buildCrossSchemaSelect,
} from './cross-schema.js';

export { withShared, WithSharedQueryBuilder } from './with-shared.js';

export type {
  SchemaSource,
  CrossSchemaContext,
  JoinCondition,
  JoinType,
  TableReference,
  JoinDefinition,
  SelectField,
  QueryBuilderState,
  SharedLookupConfig,
  LookupResult,
  CrossSchemaRawOptions,
  ColumnSelection,
  InferSelectedColumns,
  WithSharedConfig,
  WithSharedOptions,
  InferSelectResult,
} from './types.js';
