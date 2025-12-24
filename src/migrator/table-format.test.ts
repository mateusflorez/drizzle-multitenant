import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectTableFormat, getFormatConfig, DEFAULT_FORMAT, DRIZZLE_KIT_FORMAT } from './table-format.js';
import type { Pool } from 'pg';

describe('table-format', () => {
  describe('getFormatConfig', () => {
    it('should return name format config', () => {
      const config = getFormatConfig('name');

      expect(config.format).toBe('name');
      expect(config.tableName).toBe('__drizzle_migrations');
      expect(config.columns.identifier).toBe('name');
      expect(config.columns.timestamp).toBe('applied_at');
      expect(config.columns.timestampType).toBe('timestamp');
    });

    it('should return hash format config', () => {
      const config = getFormatConfig('hash');

      expect(config.format).toBe('hash');
      expect(config.columns.identifier).toBe('hash');
      expect(config.columns.timestamp).toBe('created_at');
      expect(config.columns.timestampType).toBe('timestamp');
    });

    it('should return drizzle-kit format config', () => {
      const config = getFormatConfig('drizzle-kit');

      expect(config.format).toBe('drizzle-kit');
      expect(config.columns.identifier).toBe('hash');
      expect(config.columns.timestamp).toBe('created_at');
      expect(config.columns.timestampType).toBe('bigint');
    });

    it('should use custom table name', () => {
      const config = getFormatConfig('name', '__custom_migrations');

      expect(config.tableName).toBe('__custom_migrations');
    });
  });

  describe('DEFAULT_FORMAT', () => {
    it('should use name-based format', () => {
      expect(DEFAULT_FORMAT.format).toBe('name');
      expect(DEFAULT_FORMAT.columns.identifier).toBe('name');
      expect(DEFAULT_FORMAT.columns.timestamp).toBe('applied_at');
      expect(DEFAULT_FORMAT.columns.timestampType).toBe('timestamp');
    });
  });

  describe('DRIZZLE_KIT_FORMAT', () => {
    it('should use hash-based format with bigint timestamp', () => {
      expect(DRIZZLE_KIT_FORMAT.format).toBe('drizzle-kit');
      expect(DRIZZLE_KIT_FORMAT.columns.identifier).toBe('hash');
      expect(DRIZZLE_KIT_FORMAT.columns.timestamp).toBe('created_at');
      expect(DRIZZLE_KIT_FORMAT.columns.timestampType).toBe('bigint');
    });
  });

  describe('detectTableFormat', () => {
    let mockPool: {
      query: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockPool = {
        query: vi.fn(),
      };
    });

    it('should return null when table does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ exists: false }],
      });

      const result = await detectTableFormat(
        mockPool as unknown as Pool,
        'tenant_abc',
        '__drizzle_migrations'
      );

      expect(result).toBeNull();
    });

    it('should detect name-based format (drizzle-multitenant native)', async () => {
      // Table exists
      mockPool.query.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });

      // Columns query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'name', data_type: 'character varying' },
          { column_name: 'applied_at', data_type: 'timestamp with time zone' },
        ],
      });

      const result = await detectTableFormat(
        mockPool as unknown as Pool,
        'tenant_abc',
        '__drizzle_migrations'
      );

      expect(result).not.toBeNull();
      expect(result!.format).toBe('name');
      expect(result!.columns.identifier).toBe('name');
      expect(result!.columns.timestamp).toBe('applied_at');
      expect(result!.columns.timestampType).toBe('timestamp');
    });

    it('should detect drizzle-kit format (hash + bigint)', async () => {
      // Table exists
      mockPool.query.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });

      // Columns query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'hash', data_type: 'text' },
          { column_name: 'created_at', data_type: 'bigint' },
        ],
      });

      const result = await detectTableFormat(
        mockPool as unknown as Pool,
        'tenant_abc',
        '__drizzle_migrations'
      );

      expect(result).not.toBeNull();
      expect(result!.format).toBe('drizzle-kit');
      expect(result!.columns.identifier).toBe('hash');
      expect(result!.columns.timestamp).toBe('created_at');
      expect(result!.columns.timestampType).toBe('bigint');
    });

    it('should detect hash format with regular timestamp', async () => {
      // Table exists
      mockPool.query.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });

      // Columns query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'hash', data_type: 'text' },
          { column_name: 'created_at', data_type: 'timestamp with time zone' },
        ],
      });

      const result = await detectTableFormat(
        mockPool as unknown as Pool,
        'tenant_abc',
        '__drizzle_migrations'
      );

      expect(result).not.toBeNull();
      expect(result!.format).toBe('hash');
      expect(result!.columns.identifier).toBe('hash');
      expect(result!.columns.timestamp).toBe('created_at');
      expect(result!.columns.timestampType).toBe('timestamp');
    });

    it('should return null for unknown table format', async () => {
      // Table exists
      mockPool.query.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });

      // Columns query - unknown format (no name or hash column)
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'migration_file', data_type: 'text' },
          { column_name: 'executed_at', data_type: 'timestamp' },
        ],
      });

      const result = await detectTableFormat(
        mockPool as unknown as Pool,
        'tenant_abc',
        '__drizzle_migrations'
      );

      expect(result).toBeNull();
    });

    it('should use provided table name', async () => {
      // Table exists
      mockPool.query.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });

      // Columns query
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'name', data_type: 'character varying' },
          { column_name: 'applied_at', data_type: 'timestamp with time zone' },
        ],
      });

      const result = await detectTableFormat(
        mockPool as unknown as Pool,
        'tenant_abc',
        '__custom_migrations'
      );

      expect(result!.tableName).toBe('__custom_migrations');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('information_schema.tables'),
        ['tenant_abc', '__custom_migrations']
      );
    });

    it('should handle name format with created_at timestamp', async () => {
      // Table exists
      mockPool.query.mockResolvedValueOnce({
        rows: [{ exists: true }],
      });

      // Columns query - name format but with created_at instead of applied_at
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'name', data_type: 'character varying' },
          { column_name: 'created_at', data_type: 'timestamp with time zone' },
        ],
      });

      const result = await detectTableFormat(
        mockPool as unknown as Pool,
        'tenant_abc',
        '__drizzle_migrations'
      );

      expect(result!.format).toBe('name');
      expect(result!.columns.timestamp).toBe('created_at');
    });
  });
});
