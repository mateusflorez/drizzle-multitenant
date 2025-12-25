/**
 * Export/Import Module
 *
 * Provides functionality to export Drizzle schemas to various formats
 * (JSON Schema, TypeScript types, Mermaid ERD) and import schemas
 * from JSON to generate Drizzle schema files.
 */

// Types
export type {
  ExportFormat,
  ColumnReference,
  ExportedColumn,
  ExportedIndex,
  ExportedTable,
  SchemaExport,
  JsonSchemaOutput,
  JsonSchemaDefinition,
  JsonSchemaProperty,
  TypeScriptExportOptions,
  MermaidExportOptions,
  ExportOptions,
  ImportOptions,
  ImportResult,
  ISchemaExporter,
  ISchemaImporter,
} from './types.js';

// Main exporter
export { SchemaExporter, createSchemaExporter } from './schema-exporter.js';
export type { SchemaExporterConfig } from './schema-exporter.js';

// Individual exporters
export { JsonSchemaExporter, createJsonSchemaExporter } from './json-schema-exporter.js';
export { TypeScriptExporter, createTypeScriptExporter } from './typescript-exporter.js';
export { MermaidExporter, createMermaidExporter } from './mermaid-exporter.js';

// Importer
export { SchemaImporter, createSchemaImporter, loadSchemaExport } from './importer.js';
