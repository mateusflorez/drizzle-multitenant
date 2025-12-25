/**
 * Schema Exporter
 *
 * Main exporter class that coordinates all export formats.
 * Provides a unified interface for exporting Drizzle schemas
 * to JSON Schema, TypeScript, or Mermaid ERD formats.
 */

import type { SchemaTable } from '../lint/types.js';
import { parseSchemaModule, findSchemaFiles, loadSchemaFile } from '../lint/parser.js';
import type {
  ExportedTable,
  ExportedColumn,
  ExportedIndex,
  ExportOptions,
  ExportFormat,
  SchemaExport,
} from './types.js';
import { JsonSchemaExporter } from './json-schema-exporter.js';
import { TypeScriptExporter } from './typescript-exporter.js';
import { MermaidExporter } from './mermaid-exporter.js';

/**
 * Convert internal SchemaTable to ExportedTable format
 */
function convertToExportedTable(table: SchemaTable): ExportedTable {
  return {
    name: table.name,
    schemaType: table.schemaType,
    columns: table.columns as ExportedColumn[],
    indexes: table.indexes as ExportedIndex[],
    filePath: table.filePath,
  };
}

/**
 * Schema Exporter Configuration
 */
export interface SchemaExporterConfig {
  /**
   * Directory containing tenant schemas
   */
  tenantSchemaDir?: string;

  /**
   * Directory containing shared schemas
   */
  sharedSchemaDir?: string;

  /**
   * Schema modules to export (alternative to directories)
   */
  schemas?: {
    tenant?: Record<string, unknown>;
    shared?: Record<string, unknown>;
  };
}

/**
 * Main Schema Exporter class
 */
export class SchemaExporter {
  private jsonExporter = new JsonSchemaExporter();
  private tsExporter = new TypeScriptExporter();
  private mermaidExporter = new MermaidExporter();

  /**
   * Export schemas from directories
   */
  async exportFromDirectories(
    config: {
      tenantDir?: string;
      sharedDir?: string;
    },
    options: ExportOptions
  ): Promise<string> {
    const tables: ExportedTable[] = [];

    // Load tenant schemas
    if (config.tenantDir) {
      const files = await findSchemaFiles(config.tenantDir, 'tenant');
      for (const file of files) {
        const parsedTables = await loadSchemaFile(file.filePath, 'tenant');
        tables.push(...parsedTables.map(convertToExportedTable));
      }
    }

    // Load shared schemas
    if (config.sharedDir) {
      const files = await findSchemaFiles(config.sharedDir, 'shared');
      for (const file of files) {
        const parsedTables = await loadSchemaFile(file.filePath, 'shared');
        tables.push(...parsedTables.map(convertToExportedTable));
      }
    }

    return this.export(tables, options);
  }

  /**
   * Export schemas from module objects
   */
  exportFromModules(
    schemas: {
      tenant?: Record<string, unknown>;
      shared?: Record<string, unknown>;
    },
    options: ExportOptions
  ): string {
    const tables: ExportedTable[] = [];

    // Parse tenant schema module
    if (schemas.tenant) {
      const parsedTables = parseSchemaModule(schemas.tenant, 'tenant-schema', 'tenant');
      tables.push(...parsedTables.map(convertToExportedTable));
    }

    // Parse shared schema module
    if (schemas.shared) {
      const parsedTables = parseSchemaModule(schemas.shared, 'shared-schema', 'shared');
      tables.push(...parsedTables.map(convertToExportedTable));
    }

    return this.export(tables, options);
  }

  /**
   * Export tables to the specified format
   */
  export(tables: ExportedTable[], options: ExportOptions): string {
    switch (options.format) {
      case 'json':
        return this.exportToJson(tables, options);
      case 'typescript':
        return this.tsExporter.export(tables, options);
      case 'mermaid':
        return this.mermaidExporter.export(tables, options);
      default:
        throw new Error(`Unknown export format: ${options.format}`);
    }
  }

  /**
   * Export to JSON format (internal schema format, not JSON Schema)
   */
  private exportToJson(tables: ExportedTable[], options: ExportOptions): string {
    const schemaExport: SchemaExport = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      tables,
      ...(options.projectName && { projectName: options.projectName }),
    };

    // Add metadata if requested
    if (options.includeMetadata) {
      const tenantCount = tables.filter((t) => t.schemaType === 'tenant').length;
      const sharedCount = tables.filter((t) => t.schemaType === 'shared').length;
      const totalColumns = tables.reduce((acc, t) => acc + t.columns.length, 0);
      const totalIndexes = tables.reduce((acc, t) => acc + t.indexes.length, 0);
      const totalRelations = tables.reduce(
        (acc, t) => acc + t.columns.filter((c) => c.references).length,
        0
      );

      schemaExport.metadata = {
        tenantCount,
        sharedCount,
        totalColumns,
        totalIndexes,
        totalRelations,
      };
    }

    return JSON.stringify(schemaExport, null, 2);
  }

  /**
   * Export to JSON Schema format
   */
  exportToJsonSchema(tables: ExportedTable[], options: ExportOptions): string {
    return this.jsonExporter.export(tables, options);
  }

  /**
   * Export to TypeScript types
   */
  exportToTypeScript(tables: ExportedTable[], options: ExportOptions): string {
    return this.tsExporter.export(tables, options);
  }

  /**
   * Export to Mermaid ERD
   */
  exportToMermaid(tables: ExportedTable[], options: ExportOptions): string {
    return this.mermaidExporter.export(tables, options);
  }

  /**
   * Get supported export formats
   */
  getSupportedFormats(): ExportFormat[] {
    return ['json', 'typescript', 'mermaid'];
  }
}

/**
 * Create a schema exporter instance
 */
export function createSchemaExporter(): SchemaExporter {
  return new SchemaExporter();
}
