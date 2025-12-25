/**
 * Schema Drift Detection Module
 *
 * Provides tools for detecting and analyzing schema differences
 * between tenant databases in a multi-tenant application.
 *
 * @module drift
 *
 * @example
 * ```typescript
 * import { DriftDetector, createDriftDetector } from 'drizzle-multitenant/migrator/drift';
 *
 * const detector = createDriftDetector(config, schemaManager, {
 *   migrationsTable: '__drizzle_migrations',
 *   tenantDiscovery: async () => ['tenant-1', 'tenant-2'],
 * });
 *
 * // Detect drift across all tenants
 * const status = await detector.detectDrift();
 *
 * // Compare specific tenant against reference
 * const drift = await detector.compareTenant('tenant-123', 'golden-tenant');
 *
 * // Introspect a single tenant's schema
 * const schema = await detector.introspectSchema('tenant-123');
 * ```
 */

// Main class and factory
export { DriftDetector, createDriftDetector } from './drift-detector.js';
export type { DriftDetectorConfig } from './drift-detector.js';

// Analyzers (for advanced usage)
export {
  introspectColumns,
  compareColumns,
  normalizeDefault,
} from './column-analyzer.js';

export {
  introspectIndexes,
  compareIndexes,
} from './index-analyzer.js';

export {
  introspectConstraints,
  compareConstraints,
} from './constraint-analyzer.js';

// Types
export type {
  // Introspection types
  ColumnInfo,
  IndexInfo,
  ConstraintInfo,
  TableSchema,
  TenantSchema,
  // Drift result types
  ColumnDrift,
  IndexDrift,
  ConstraintDrift,
  TableDrift,
  TenantSchemaDrift,
  SchemaDriftStatus,
  // Options
  SchemaDriftOptions,
  IntrospectOptions,
} from './types.js';
