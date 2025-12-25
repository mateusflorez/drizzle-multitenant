/**
 * Mermaid ERD Exporter
 *
 * Exports Drizzle schemas to Mermaid ERD (Entity-Relationship Diagram)
 * format for documentation and visualization.
 */

import type {
  ExportedTable,
  ExportedColumn,
  ISchemaExporter,
  ExportOptions,
  MermaidExportOptions,
} from './types.js';

/**
 * Map PostgreSQL/Drizzle data types to shorter ERD-friendly types
 */
function shortenDataType(dataType: string): string {
  const type = dataType.toLowerCase();

  if (type === 'uuid') return 'uuid';
  if (type === 'text' || type === 'string') return 'text';
  if (type.startsWith('varchar') || type.startsWith('character varying')) return 'varchar';
  if (type.startsWith('char') || type.startsWith('character')) return 'char';
  if (type === 'integer' || type === 'int' || type === 'int4') return 'int';
  if (type === 'smallint' || type === 'int2') return 'smallint';
  if (type === 'bigint' || type === 'int8') return 'bigint';
  if (type === 'serial' || type === 'serial4') return 'serial';
  if (type === 'bigserial' || type === 'serial8') return 'bigserial';
  if (type === 'real' || type === 'float4' || type === 'float') return 'float';
  if (type === 'double precision' || type === 'float8') return 'double';
  if (type.startsWith('numeric') || type.startsWith('decimal')) return 'decimal';
  if (type === 'boolean' || type === 'bool') return 'bool';
  if (type === 'date') return 'date';
  if (type.startsWith('timestamp')) return 'timestamp';
  if (type === 'time' || type.startsWith('time ')) return 'time';
  if (type === 'json' || type === 'jsonb') return 'json';
  if (type === 'bytea') return 'binary';

  return type;
}

/**
 * Get Mermaid key marker for a column
 * PK = Primary Key, FK = Foreign Key
 */
function getKeyMarker(column: ExportedColumn): string {
  if (column.isPrimaryKey && column.references) {
    return 'PK,FK';
  }
  if (column.isPrimaryKey) {
    return 'PK';
  }
  if (column.references) {
    return 'FK';
  }
  return '';
}

/**
 * Convert table name to Mermaid-safe identifier
 */
function toMermaidId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Generate ERD relationship notation
 * ||--o{ = one-to-many
 * ||--|| = one-to-one
 * }o--o{ = many-to-many (rare in normalized schemas)
 */
function getRelationshipType(
  _sourceColumn: ExportedColumn,
  _sourceTable: ExportedTable
): string {
  // Default to one-to-many (most common)
  // Could be enhanced by analyzing unique constraints
  return '||--o{';
}

/**
 * Mermaid ERD Exporter
 */
export class MermaidExporter implements ISchemaExporter {
  export(tables: ExportedTable[], options: ExportOptions): string {
    const mermaidOptions: MermaidExportOptions = options.mermaid ?? {};
    const lines: string[] = [];

    // Header with theme
    lines.push('```mermaid');
    if (mermaidOptions.theme && mermaidOptions.theme !== 'default') {
      lines.push(`%%{init: {'theme': '${mermaidOptions.theme}'}}%%`);
    }
    lines.push('erDiagram');
    lines.push('');

    // Separate by schema type
    const tenantTables = tables.filter((t) => t.schemaType === 'tenant');
    const sharedTables = tables.filter((t) => t.schemaType === 'shared');

    // Add tenant tables comment
    if (tenantTables.length > 0) {
      lines.push('    %% Tenant Schema Tables');
      for (const table of tenantTables) {
        lines.push(...this.generateTableDefinition(table, mermaidOptions));
      }
      lines.push('');
    }

    // Add shared tables comment
    if (sharedTables.length > 0) {
      lines.push('    %% Shared Schema Tables');
      for (const table of sharedTables) {
        lines.push(...this.generateTableDefinition(table, mermaidOptions));
      }
      lines.push('');
    }

    // Generate relationships
    const relationships = this.generateRelationships(tables);
    if (relationships.length > 0) {
      lines.push('    %% Relationships');
      lines.push(...relationships);
    }

    lines.push('```');

    return lines.join('\n');
  }

  /**
   * Generate table definition in Mermaid ERD format
   */
  private generateTableDefinition(
    table: ExportedTable,
    options: MermaidExportOptions
  ): string[] {
    const lines: string[] = [];
    const tableId = toMermaidId(table.name);

    lines.push(`    ${tableId} {`);

    for (const column of table.columns) {
      const parts: string[] = [];

      // Data type
      if (options.includeDataTypes !== false) {
        parts.push(shortenDataType(column.dataType));
      }

      // Column name
      parts.push(column.name);

      // Key markers
      if (options.showPrimaryKeys !== false || options.showForeignKeys !== false) {
        const keyMarker = getKeyMarker(column);
        if (keyMarker) {
          parts.push(keyMarker);
        }
      }

      // Optional comment for nullable
      if (column.isNullable) {
        parts.push('"nullable"');
      }

      lines.push(`        ${parts.join(' ')}`);
    }

    lines.push('    }');

    // Add indexes as comment if requested
    if (options.includeIndexes && table.indexes.length > 0) {
      const indexNames = table.indexes.map((idx) => {
        const unique = idx.isUnique ? '(unique)' : '';
        return `${idx.name}${unique}`;
      });
      lines.push(`    %% Indexes: ${indexNames.join(', ')}`);
    }

    return lines;
  }

  /**
   * Generate relationship lines
   */
  private generateRelationships(tables: ExportedTable[]): string[] {
    const lines: string[] = [];
    const tableMap = new Map(tables.map((t) => [t.name, t]));

    for (const table of tables) {
      for (const column of table.columns) {
        if (!column.references) continue;

        const targetTable = tableMap.get(column.references.table);
        if (!targetTable) continue;

        const sourceId = toMermaidId(table.name);
        const targetId = toMermaidId(column.references.table);
        const relationship = getRelationshipType(column, table);
        const label = `"${column.name} -> ${column.references.column}"`;

        lines.push(`    ${targetId} ${relationship} ${sourceId} : ${label}`);
      }
    }

    return lines;
  }
}

/**
 * Create a Mermaid exporter instance
 */
export function createMermaidExporter(): MermaidExporter {
  return new MermaidExporter();
}
