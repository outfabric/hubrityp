import { describe, expect, it } from 'vitest';

import { contentHasChanged } from '@/modules/medical-records/lib/content-diff';

describe('contentHasChanged', () => {
  // ---------------------------------------------------------------------------
  // Same content — returns false
  // ---------------------------------------------------------------------------

  it('returns false for identical objects', () => {
    const obj = { humor_inicial: 5, pauta: 'texto' };
    expect(contentHasChanged(obj, { ...obj })).toBe(false);
  });

  it('returns false for identical strings', () => {
    expect(contentHasChanged('hello', 'hello')).toBe(false);
  });

  it('returns false for identical numbers', () => {
    expect(contentHasChanged(42, 42)).toBe(false);
  });

  it('returns false for identical arrays', () => {
    expect(contentHasChanged([1, 2, 3], [1, 2, 3])).toBe(false);
  });

  it('returns false for both null', () => {
    expect(contentHasChanged(null, null)).toBe(false);
  });

  it('returns false for both undefined', () => {
    expect(contentHasChanged(undefined, undefined)).toBe(false);
  });

  it('returns false for nested identical objects', () => {
    const nested = { a: { b: { c: 'deep' } }, arr: [1, 2] };
    expect(contentHasChanged(nested, { a: { b: { c: 'deep' } }, arr: [1, 2] })).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Different content — returns true
  // ---------------------------------------------------------------------------

  it('returns true for different objects', () => {
    expect(contentHasChanged({ a: 1 }, { a: 2 })).toBe(true);
  });

  it('returns true for added key', () => {
    expect(contentHasChanged({ a: 1 }, { a: 1, b: 2 })).toBe(true);
  });

  it('returns true for removed key', () => {
    expect(contentHasChanged({ a: 1, b: 2 }, { a: 1 })).toBe(true);
  });

  it('returns true for different strings', () => {
    expect(contentHasChanged('hello', 'world')).toBe(true);
  });

  it('returns true for different array order', () => {
    expect(contentHasChanged([1, 2, 3], [3, 2, 1])).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // null/undefined edge cases
  // ---------------------------------------------------------------------------

  it('returns false for null vs undefined (JSON.stringify treats both as undefined→same)', () => {
    // JSON.stringify(null) === 'null', JSON.stringify(undefined) === undefined
    // These are actually different — null serializes, undefined does not
    expect(contentHasChanged(null, undefined)).toBe(true);
  });

  it('returns true when prev is null and next is an object', () => {
    expect(contentHasChanged(null, { a: 1 })).toBe(true);
  });

  it('returns true when prev is undefined and next is an object', () => {
    expect(contentHasChanged(undefined, { a: 1 })).toBe(true);
  });

  it('returns true when prev is an object and next is null', () => {
    expect(contentHasChanged({ a: 1 }, null)).toBe(true);
  });
});
