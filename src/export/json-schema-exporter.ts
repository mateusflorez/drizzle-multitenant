/**
 * JSON Schema Exporter
 *
 * Exports Drizzle schemas to JSON Schema format for documentation
 * and cross-platform interoperability.
 */

import type {
  ExportedTable,
  JsonSchemaOutput,
  JsonSchemaDefinition,
  JsonSchemaProperty,
  ISchemaExporter,
  ExportOptions,
} from './types.js';

/**
 * Map PostgreSQL/Drizzle data types to JSON Schema types
 */
function mapDataTypeToJsonSchema(
  dataType: string
): Pick<JsonSchemaProperty, 'type' | 'format' | 'maxLength' | 'minimum' | 'maximum'> {
  const type = dataType.toLowerCase();

  // UUID
  if (type === 'uuid') {
    return { type: 'string', format: 'uuid' };
  }

  // Text types
  if (type === 'text' || type === 'string') {
    return { type: 'string' };
  }

  // Varchar with length
  if (type.startsWith('varchar') || type.startsWith('character varying')) {
    const match = type.match(/\((\d+)\)/);
    const maxLength = match?.[1] ? parseInt(match[1], 10) : undefined;
    return { type: 'string', ...(maxLength && { maxLength }) };
  }

  // Char
  if (type.startsWith('char') || type.startsWith('character')) {
    const match = type.match(/\((\d+)\)/);
    const maxLength = match?.[1] ? parseInt(match[1], 10) : undefined;
    return { type: 'string', ...(maxLength && { maxLength }) };
  }

  // Integer types
  if (type === 'integer' || type === 'int' || type === 'int4') {
    return { type: 'integer', minimum: -2147483648, maximum: 2147483647 };
  }

  if (type === 'smallint' || type === 'int2') {
    return { type: 'integer', minimum: -32768, maximum: 32767 };
  }

  if (type === 'bigint' || type === 'int8') {
    return { type: 'integer' };
  }

  if (type === 'serial' || type === 'serial4') {
    return { type: 'integer', minimum: 1, maximum: 2147483647 };
  }

  if (type === 'bigserial' || type === 'serial8') {
    return { type: 'integer', minimum: 1 };
  }

  if (type === 'smallserial' || type === 'serial2') {
    return { type: 'integer', minimum: 1, maximum: 32767 };
  }

  // Float types
  if (type === 'real' || type === 'float4' || type === 'float') {
    return { type: 'number' };
  }

  if (type === 'double precision' || type === 'float8' || type === 'double') {
    return { type: 'number' };
  }

  if (type.startsWith('numeric') || type.startsWith('decimal')) {
    return { type: 'number' };
  }

  // Boolean
  if (type === 'boolean' || type === 'bool') {
    return { type: 'boolean' };
  }

  // Date/Time types
  if (type === 'date') {
    return { type: 'string', format: 'date' };
  }

  if (type.startsWith('timestamp')) {
    return { type: 'string', format: 'date-time' };
  }

  if (type === 'time' || type.startsWith('time ')) {
    return { type: 'string', format: 'time' };
  }

  if (type === 'interval') {
    return { type: 'string' };
  }

  // JSON types
  if (type === 'json' || type === 'jsonb') {
    return { type: ['object', 'array', 'string', 'number', 'boolean', 'null'] };
  }

  // Array types
  if (type.endsWith('[]')) {
    return { type: 'array' };
  }

  // Enum types (treated as string)
  if (type.startsWith('enum')) {
    return { type: 'string' };
  }

  // Binary
  if (type === 'bytea') {
    return { type: 'string', format: 'byte' };
  }

  // CIDR/INET/MAC
  if (type === 'inet' || type === 'cidr') {
    return { type: 'string' };
  }

  if (type === 'macaddr' || type === 'macaddr8') {
    return { type: 'string' };
  }

  // Default to string for unknown types
  return { type: 'string' };
}

/**
 * Convert table name to schema definition name (PascalCase)
 */
function toDefinitionName(tableName: string): string {
  return tableName
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

/**
 * Export a single table to JSON Schema definition
 */
function exportTableToDefinition(table: ExportedTable): JsonSchemaDefinition {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const column of table.columns) {
    const schemaType = mapDataTypeToJsonSchema(column.dataType);

    const property: JsonSchemaProperty = {
      ...schemaType,
    };

    // Add description for special columns
    if (column.isPrimaryKey) {
      property.description = 'Primary key';
    } else if (column.references) {
      property.description = `Foreign key to ${column.references.table}.${column.references.column}`;
      property.$ref = `#/definitions/${toDefinitionName(column.references.table)}`;
    }

    // Add default value if present
    if (column.hasDefault && column.defaultValue != null && column.defaultValue !== '') {
      // Try to parse the default value
      const defaultStr = column.defaultValue;
      if (defaultStr === 'true' || defaultStr === 'false') {
        property.default = defaultStr === 'true';
      } else if (!isNaN(Number(defaultStr))) {
        property.default = Number(defaultStr);
      } else if (defaultStr.startsWith("'") && defaultStr.endsWith("'")) {
        property.default = defaultStr.slice(1, -1);
      }
    }

    // Handle nullable columns
    if (column.isNullable && typeof property.type === 'string') {
      property.type = [property.type, 'null'];
    }

    properties[column.name] = property;

    // Add to required if not nullable and no default
    if (!column.isNullable && !column.hasDefault) {
      required.push(column.name);
    }
  }

  return {
    type: 'object',
    description: `Schema for ${table.name} table (${table.schemaType})`,
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * JSON Schema Exporter
 */
export class JsonSchemaExporter implements ISchemaExporter {
  export(tables: ExportedTable[], options: ExportOptions): string {
    const definitions: Record<string, JsonSchemaDefinition> = {};

    for (const table of tables) {
      const defName = toDefinitionName(table.name);
      definitions[defName] = exportTableToDefinition(table);
    }

    const output: JsonSchemaOutput = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...(options.projectName && { $id: `${options.projectName}/schemas` }),
      title: options.projectName
        ? `${options.projectName} Database Schemas`
        : 'Database Schemas',
      description: `Auto-generated JSON Schema from Drizzle ORM schema definitions`,
      definitions,
    };

    return JSON.stringify(output, null, 2);
  }
}

/**
 * Create a JSON Schema exporter instance
 */
export function createJsonSchemaExporter(): JsonSchemaExporter {
  return new JsonSchemaExporter();
}
