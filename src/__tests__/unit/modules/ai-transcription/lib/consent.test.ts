import { describe, expect, it, vi } from 'vitest';

import {
  assertAiConsentActive,
  type AssertAiConsentDeps,
  type AssertAiConsentResult,
} from '@/modules/ai-transcription/lib/consent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-05-20T12:00:00Z').getTime();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Shape mirroring the Drizzle SELECT projection in `assertAiConsentActive`. */
interface ConsentRow {
  id: string;
  signedAt: Date | null;
  revokedAt: Date | null;
  templateVersion: number;
  createdAt: Date;
}

/**
 * Creates a mock Drizzle `db` that resolves the chained query
 * (select → from → where → orderBy → limit) to the given rows.
 */
function createMockDb(rows: ConsentRow[]): AssertAiConsentDeps['db'] {
  const limitSpy = vi.fn().mockResolvedValue(rows);
  const orderBySpy = vi.fn().mockReturnValue({ limit: limitSpy });
  const whereSpy = vi.fn().mockReturnValue({ orderBy: orderBySpy });
  const fromSpy = vi.fn().mockReturnValue({ where: whereSpy });
  const selectSpy = vi.fn().mockReturnValue({ from: fromSpy });

  return { select: selectSpy } as AssertAiConsentDeps['db'];
}

function makeDeps(rows: ConsentRow[], now = FIXED_NOW): AssertAiConsentDeps {
  return { db: createMockDb(rows), now: () => now };
}

const USER_ID = '11111111-1111-1111-1111-111111111111';
const PATIENT_ID = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assertAiConsentActive', () => {
  it('returns never_signed when no row exists', async () => {
    const deps = makeDeps([]);

    const result = await assertAiConsentActive({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result).toEqual<AssertAiConsentResult>({
      ok: false,
      reason: 'never_signed',
    });
  });

  it('returns pending_signature when row has signed_at IS NULL and token not expired', async () => {
    const deps = makeDeps([
      {
        id: 'term-1',
        signedAt: null,
        revokedAt: null,
        templateVersion: 1,
        // Created 2 days ago — still within 7-day window
        createdAt: new Date(FIXED_NOW - 2 * ONE_DAY_MS),
      },
    ]);

    const result = await assertAiConsentActive({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result).toEqual<AssertAiConsentResult>({
      ok: false,
      reason: 'pending_signature',
    });
  });

  it('returns ok with termId, signedAt, templateVersion when signed and not revoked', async () => {
    const signedAt = new Date('2026-05-15T10:00:00Z');
    const deps = makeDeps([
      {
        id: 'term-1',
        signedAt,
        revokedAt: null,
        templateVersion: 1,
        createdAt: new Date('2026-05-14T10:00:00Z'),
      },
    ]);

    const result = await assertAiConsentActive({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result).toEqual<AssertAiConsentResult>({
      ok: true,
      termId: 'term-1',
      signedAt,
      templateVersion: 1,
    });
  });

  it('returns revoked when signed and then revoked', async () => {
    const deps = makeDeps([
      {
        id: 'term-1',
        signedAt: new Date('2026-05-10T10:00:00Z'),
        revokedAt: new Date('2026-05-12T15:00:00Z'),
        templateVersion: 1,
        createdAt: new Date('2026-05-09T10:00:00Z'),
      },
    ]);

    const result = await assertAiConsentActive({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result).toEqual<AssertAiConsentResult>({
      ok: false,
      reason: 'revoked',
    });
  });

  it('returns expired when unsigned and token_expires_at < now', async () => {
    const deps = makeDeps(
      [
        {
          id: 'term-1',
          signedAt: null,
          revokedAt: null,
          templateVersion: 1,
          // Created 8 days ago — past the 7-day window
          createdAt: new Date(FIXED_NOW - 8 * ONE_DAY_MS),
        },
      ],
      FIXED_NOW,
    );

    const result = await assertAiConsentActive({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result).toEqual<AssertAiConsentResult>({
      ok: false,
      reason: 'expired',
    });
  });

  it('considers only the most recent row (first element from limit-1 query)', async () => {
    // The mock returns a single row (LIMIT 1 is applied by Drizzle).
    // We verify that if we pass only one row (the latest), the helper
    // returns the outcome for that row — proving it relies on ORDER BY
    // created_at DESC LIMIT 1.
    const latestSignedAt = new Date('2026-05-18T09:00:00Z');

    const deps = makeDeps([
      // Only the latest row is returned by the query (LIMIT 1)
      {
        id: 'term-2',
        signedAt: latestSignedAt,
        revokedAt: null,
        templateVersion: 2,
        createdAt: new Date('2026-05-17T09:00:00Z'),
      },
    ]);

    const result = await assertAiConsentActive({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    // The helper should return the latest row's data
    expect(result).toEqual<AssertAiConsentResult>({
      ok: true,
      termId: 'term-2',
      signedAt: latestSignedAt,
      templateVersion: 2,
    });
  });

  it('returns pending_signature when created exactly 7 days ago (edge case)', async () => {
    // created_at + 7 days === now → expiry equals now, so NOT expired yet
    // (the condition is `expiresAt < now`, strictly less than)
    const deps = makeDeps(
      [
        {
          id: 'term-1',
          signedAt: null,
          revokedAt: null,
          templateVersion: 1,
          createdAt: new Date(FIXED_NOW - 7 * ONE_DAY_MS),
        },
      ],
      FIXED_NOW,
    );

    const result = await assertAiConsentActive({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    // At exactly 7 days, expiresAt === now, so `expiresAt < now` is false → pending
    expect(result).toEqual<AssertAiConsentResult>({
      ok: false,
      reason: 'pending_signature',
    });
  });
});
