import { flatten, parseScalar } from './configuration';

describe('configuration', () => {
  describe('parseScalar', () => {
    it('should parse "true" as boolean true', () => {
      expect(parseScalar('true')).toBe(true);
    });

    it('should parse "TRUE" as boolean true (case-insensitive)', () => {
      expect(parseScalar('TRUE')).toBe(true);
    });

    it('should parse "True" as boolean true (case-insensitive)', () => {
      expect(parseScalar('True')).toBe(true);
    });

    it('should parse "false" as boolean false', () => {
      expect(parseScalar('false')).toBe(false);
    });

    it('should parse "FALSE" as boolean false (case-insensitive)', () => {
      expect(parseScalar('FALSE')).toBe(false);
    });

    it('should parse "False" as boolean false (case-insensitive)', () => {
      expect(parseScalar('False')).toBe(false);
    });

    it('should keep numeric strings as strings', () => {
      expect(parseScalar('8080')).toBe('8080');
      expect(parseScalar('0')).toBe('0');
      expect(parseScalar('3.14')).toBe('3.14');
    });

    it('should keep strings with leading zeros as strings', () => {
      expect(parseScalar('007')).toBe('007');
    });

    it('should keep regular strings as strings', () => {
      expect(parseScalar('hello')).toBe('hello');
      expect(parseScalar('http://localhost:5984')).toBe('http://localhost:5984');
    });

    it('should keep empty string as string', () => {
      expect(parseScalar('')).toBe('');
    });

    it('should not treat "falsy" or "truthy" as booleans', () => {
      expect(parseScalar('falsy')).toBe('falsy');
      expect(parseScalar('truthy')).toBe('truthy');
    });
  });

  describe('flatten', () => {
    it('should flatten nested objects with underscore delimiter', () => {
      const input = { SENTRY: { ENABLED: true, DSN: 'https://example.com' } };
      expect(flatten(input)).toEqual({
        SENTRY_ENABLED: true,
        SENTRY_DSN: 'https://example.com',
      });
    });

    it('should preserve scalar types (booleans, numbers, strings)', () => {
      const input = { flag: false, count: 42, name: 'test' };
      expect(flatten(input)).toEqual({
        flag: false,
        count: 42,
        name: 'test',
      });
    });

    it('should handle deeply nested objects', () => {
      const input = { a: { b: { c: 'deep' } } };
      expect(flatten(input)).toEqual({ a_b_c: 'deep' });
    });

    it('should skip null values', () => {
      const input = { a: null, b: 'kept' };
      expect(flatten(input)).toEqual({ b: 'kept' });
    });

    it('should stringify arrays as values', () => {
      const input = { list: ['a', 'b'] };
      expect(flatten(input)).toEqual({ list: ['a', 'b'] });
    });

    it('should handle empty objects', () => {
      expect(flatten({})).toEqual({});
    });
  });
});
