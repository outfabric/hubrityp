import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  documentVersions,
  getDocumentVersion,
} from '@/modules/account-lifecycle/lib/document-versions';

describe('documentVersions — values', () => {
  it('exposes the pinned LGPD doc versions for May 2026', () => {
    expect(documentVersions.terms).toBe('2026-05');
    expect(documentVersions.privacy).toBe('2026-05');
    expect(documentVersions.sensitiveData).toBe('2026-05');
  });

  it('has exactly the three expected keys (no stray additions)', () => {
    expect(Object.keys(documentVersions).sort()).toEqual(['privacy', 'sensitiveData', 'terms']);
  });
});

describe('documentVersions — `as const` literal types', () => {
  // These are TS-only assertions: they fail at typecheck time, not at
  // runtime. If `as const` is dropped from the source, the literal types
  // collapse to `string` and these assertions fail.
  it('preserves the literal type for each key', () => {
    expectTypeOf(documentVersions.terms).toEqualTypeOf<'2026-05'>();
    expectTypeOf(documentVersions.privacy).toEqualTypeOf<'2026-05'>();
    expectTypeOf(documentVersions.sensitiveData).toEqualTypeOf<'2026-05'>();
  });

  it('preserves the literal type through the typed accessor', () => {
    expectTypeOf(getDocumentVersion('terms')).toEqualTypeOf<'2026-05'>();
    expectTypeOf(getDocumentVersion('privacy')).toEqualTypeOf<'2026-05'>();
    expectTypeOf(getDocumentVersion('sensitiveData')).toEqualTypeOf<'2026-05'>();
  });
});

describe('getDocumentVersion — runtime', () => {
  it('returns the exact string from the constant for every key', () => {
    expect(getDocumentVersion('terms')).toBe('2026-05');
    expect(getDocumentVersion('privacy')).toBe('2026-05');
    expect(getDocumentVersion('sensitiveData')).toBe('2026-05');
  });
});
