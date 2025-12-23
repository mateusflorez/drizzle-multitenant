export {
  CrossSchemaQueryBuilder,
  createCrossSchemaQuery,
  withSharedLookup,
  crossSchemaRaw,
  buildCrossSchemaSelect,
} from './cross-schema.js';

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
} from './types.js';
