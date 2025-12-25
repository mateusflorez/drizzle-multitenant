/**
 * Types for schema export/import functionality
 */

/**
 * Supported export formats
 */
export type ExportFormat = 'json' | 'typescript' | 'mermaid';

/**
 * Column reference (foreign key)
 */
export interface ColumnReference {
  table: string;
  column: string;
  onDelete?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
  onUpdate?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
}

/**
 * Exported column definition
 */
export interface ExportedColumn {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  hasDefault: boolean;
  defaultValue?: string | null;
  references?: ColumnReference;
}

/**
 * Exported index definition
 */
export interface ExportedIndex {
  name: string;
  columns: string[];
  isUnique: boolean;
}

/**
 * Exported table definition
 */
export interface ExportedTable {
  name: string;
  schemaType: 'tenant' | 'shared';
  columns: ExportedColumn[];
  indexes: ExportedIndex[];
  filePath?: string;
}

/**
 * Complete schema export structure
 */
export interface SchemaExport {
  version: string;
  exportedAt: string;
  projectName?: string;
  tables: ExportedTable[];
  metadata?: {
    tenantCount: number;
    sharedCount: number;
    totalColumns: number;
    totalIndexes: number;
    totalRelations: number;
  };
}

/**
 * JSON Schema format output
 */
export interface JsonSchemaOutput {
  $schema: string;
  $id?: string;
  title: string;
  description?: string;
  definitions: Record<string, JsonSchemaDefinition>;
}

/**
 * JSON Schema definition for a table
 */
export interface JsonSchemaDefinition {
  type: 'object';
  description?: string;
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: boolean;
}

/**
 * JSON Schema property for a column
 */
export interface JsonSchemaProperty {
  type: string | string[];
  format?: string;
  description?: string;
  default?: unknown;
  $ref?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

/**
 * TypeScript export options
 */
export interface TypeScriptExportOptions {
  /**
   * Include Zod schema generation
   */
  includeZod?: boolean;

  /**
   * Include insert types (NewTableName)
   */
  includeInsertTypes?: boolean;

  /**
   * Include select types (TableName)
   */
  includeSelectTypes?: boolean;

  /**
   * Generate barrel export file
   */
  generateBarrel?: boolean;
}

/**
 * Mermaid ERD export options
 */
export interface MermaidExportOptions {
  /**
   * Include column data types
   */
  includeDataTypes?: boolean;

  /**
   * Include indexes as notes
   */
  includeIndexes?: boolean;

  /**
   * Show primary keys
   */
  showPrimaryKeys?: boolean;

  /**
   * Show foreign keys
   */
  showForeignKeys?: boolean;

  /**
   * Theme for the ERD
   */
  theme?: 'default' | 'dark' | 'forest' | 'neutral';
}

/**
 * Export options
 */
export interface ExportOptions {
  /**
   * Export format
   */
  format: ExportFormat;

  /**
   * Project name for the export
   */
  projectName?: string;

  /**
   * Include metadata in export
   */
  includeMetadata?: boolean;

  /**
   * TypeScript-specific options
   */
  typescript?: TypeScriptExportOptions;

  /**
   * Mermaid-specific options
   */
  mermaid?: MermaidExportOptions;
}

/**
 * Import options
 */
export interface ImportOptions {
  /**
   * Output directory for generated files
   */
  outputDir: string;

  /**
   * Overwrite existing files
   */
  overwrite?: boolean;

  /**
   * Generate tenant schemas
   */
  generateTenant?: boolean;

  /**
   * Generate shared schemas
   */
  generateShared?: boolean;

  /**
   * Include Zod validation schemas
   */
  includeZod?: boolean;

  /**
   * Include TypeScript types
   */
  includeTypes?: boolean;

  /**
   * Dry run - don't write files
   */
  dryRun?: boolean;
}

/**
 * Import result
 */
export interface ImportResult {
  success: boolean;
  filesCreated: string[];
  filesSkipped: string[];
  errors: Array<{
    file: string;
    error: string;
  }>;
}

/**
 * Exporter interface
 */
export interface ISchemaExporter {
  /**
   * Export schemas to the specified format
   */
  export(tables: ExportedTable[], options: ExportOptions): string;
}

/**
 * Importer interface
 */
export interface ISchemaImporter {
  /**
   * Import schemas from JSON and generate Drizzle schema files
   */
  import(schema: SchemaExport, options: ImportOptions): Promise<ImportResult>;
}
