import { describe, expect, it } from 'vitest';

import { searchCid10 } from '@/modules/medical-records/lib/cid10-search';

describe('searchCid10', () => {
  describe('code prefix match', () => {
    it('returns F32.x codes when searching "F32"', () => {
      const results = searchCid10('F32');

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.code.startsWith('F32'))).toBe(true);
    });

    it('returns exact code match when searching full code "A00.0"', () => {
      const results = searchCid10('A00.0');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.code).toBe('A00.0');
    });
  });

  describe('description substring match', () => {
    it('matches "depressao" against entries with "Depressão"', () => {
      const results = searchCid10('depressao');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.description.toLowerCase().includes('depress'))).toBe(true);
    });
  });

  describe('accent-insensitive search', () => {
    it('finds "colera" matching "Cólera"', () => {
      const results = searchCid10('colera');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.description.toLowerCase().includes('cólera'))).toBe(true);
    });

    it('finds "febre tifoide" matching "Febre tifóide"', () => {
      const results = searchCid10('febre tifoide');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.description.toLowerCase().includes('febre tifóide'))).toBe(true);
    });
  });

  describe('case-insensitive search', () => {
    it('finds "f32" (lowercase) matching F32 codes', () => {
      const results = searchCid10('f32');

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.code.startsWith('F32'))).toBe(true);
    });

    it('finds "COLERA" (uppercase) matching descriptions', () => {
      const results = searchCid10('COLERA');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.description.toLowerCase().includes('cólera'))).toBe(true);
    });
  });

  describe('empty query', () => {
    it('returns empty array for empty string', () => {
      expect(searchCid10('')).toEqual([]);
    });

    it('returns empty array for whitespace-only query', () => {
      expect(searchCid10('   ')).toEqual([]);
    });
  });

  describe('result limit', () => {
    it('respects limit=5 by returning at most 5 results', () => {
      const results = searchCid10('F', 5);

      expect(results.length).toBeLessThanOrEqual(5);
      expect(results.length).toBe(5);
    });

    it('defaults to max 20 results when limit is not specified', () => {
      const results = searchCid10('a');

      expect(results.length).toBeLessThanOrEqual(20);
    });
  });

  describe('no matches', () => {
    it('returns empty array for query with no matches', () => {
      const results = searchCid10('xyznonexistent123');

      expect(results).toEqual([]);
    });
  });

  describe('sorting', () => {
    it('places exact code prefix matches before description matches', () => {
      // "F32" should match both code-prefix (F32.x) and possibly
      // some descriptions containing "f32". Code-prefix matches
      // should come first.
      const results = searchCid10('F32');

      // All results should start with F32 since they are code-prefix matches
      const firstResult = results[0]!;
      expect(firstResult.code.startsWith('F32')).toBe(true);
    });

    it('sorts code prefix matches alphabetically by code', () => {
      const results = searchCid10('F3');

      // Filter to only code-prefix matches for assertion
      const codePrefixResults = results.filter((r) => r.code.startsWith('F3'));

      for (let i = 1; i < codePrefixResults.length; i++) {
        expect(
          codePrefixResults[i]!.code.localeCompare(codePrefixResults[i - 1]!.code),
        ).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('result shape', () => {
    it('returns objects with code and description fields only', () => {
      const results = searchCid10('A00');

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(Object.keys(result).sort()).toEqual(['code', 'description']);
        expect(typeof result.code).toBe('string');
        expect(typeof result.description).toBe('string');
      }
    });
  });
});
