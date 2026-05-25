import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAiConsentStatusImpl } from '@/modules/patients/server/get-ai-consent-status';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectCallIndex = 0;
let selectResults: Record<string, unknown>[][] = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => {
            const result = selectResults[selectCallIndex] ?? [];
            selectCallIndex++;
            return Promise.resolve(result);
          }),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => {
              const result = selectResults[selectCallIndex] ?? [];
              selectCallIndex++;
              return Promise.resolve(result);
            }),
          })),
        })),
      })),
    })),
  },
}));

vi.mock('@/shared/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = randomUUID();
const MOCK_PATIENT_ID = randomUUID();
const OTHER_USER_PATIENT_ID = randomUUID();
const MOCK_TOKEN = 'abc123def456ghi789jkl012mno345pqrst678uvwx';

function createMockSupabase(overrides?: { authenticated?: boolean; userId?: string }) {
  const { authenticated = true, userId = MOCK_USER_ID } = overrides ?? {};

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authenticated ? { id: userId } : null },
      }),
    },
  } as unknown as Parameters<typeof getAiConsentStatusImpl>[0];
}

function setupSelects(results: Record<string, unknown>[][]) {
  selectCallIndex = 0;
  selectResults = results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getAiConsentStatusImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallIndex = 0;
    selectResults = [];
  });

  describe('authentication', () => {
    it('returns UNAUTHORIZED when user is anonymous', async () => {
      const supabase = createMockSupabase({ authenticated: false });

      const result = await getAiConsentStatusImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    });
  });

  describe('state: none', () => {
    it('returns none when no ai_recording terms exist', async () => {
      // First select: patient found; Second select: no terms
      setupSelects([[{ id: MOCK_PATIENT_ID }], []]);

      const supabase = createMockSupabase();
      const result = await getAiConsentStatusImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result).toEqual({ ok: true, consent: { state: 'none' } });
    });

    it("returns none for another user's patient (does not leak existence)", async () => {
      // Patient not found for this user → returns 'none'
      setupSelects([[]]);

      const supabase = createMockSupabase();
      const result = await getAiConsentStatusImpl(supabase, { patientId: OTHER_USER_PATIENT_ID });

      expect(result).toEqual({ ok: true, consent: { state: 'none' } });
    });

    it('returns none when the only term is expired (unsigned, older than 7 days)', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      setupSelects([
        [{ id: MOCK_PATIENT_ID }],
        [
          {
            id: randomUUID(),
            signedAt: null,
            revokedAt: null,
            signatureToken: MOCK_TOKEN,
            templateVersion: 1,
            revocationReason: null,
            createdAt: eightDaysAgo,
          },
        ],
      ]);

      const supabase = createMockSupabase();
      const result = await getAiConsentStatusImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result).toEqual({ ok: true, consent: { state: 'none' } });
    });
  });

  describe('state: pending', () => {
    it('returns pending for an unsigned term within expiry window', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      setupSelects([
        [{ id: MOCK_PATIENT_ID }],
        [
          {
            id: randomUUID(),
            signedAt: null,
            revokedAt: null,
            signatureToken: MOCK_TOKEN,
            templateVersion: 1,
            revocationReason: null,
            createdAt: oneHourAgo,
          },
        ],
      ]);

      const supabase = createMockSupabase();
      const result = await getAiConsentStatusImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.consent.state).toBe('pending');
        if (result.consent.state === 'pending') {
          expect(result.consent.publicUrl).toBe(`/termo/${MOCK_TOKEN}`);
          expect(result.consent.expiresAt).toBeInstanceOf(Date);
          expect(result.consent.createdAt).toEqual(oneHourAgo);
        }
      }
    });
  });

  describe('state: active', () => {
    it('returns active for a signed, non-revoked term', async () => {
      const signedDate = new Date('2025-01-15T10:00:00Z');
      setupSelects([
        [{ id: MOCK_PATIENT_ID }],
        [
          {
            id: randomUUID(),
            signedAt: signedDate,
            revokedAt: null,
            signatureToken: MOCK_TOKEN,
            templateVersion: 1,
            revocationReason: null,
            createdAt: new Date('2025-01-10T10:00:00Z'),
          },
        ],
      ]);

      const supabase = createMockSupabase();
      const result = await getAiConsentStatusImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.consent).toEqual({
          state: 'active',
          signedAt: signedDate,
          templateVersion: 1,
        });
      }
    });
  });

  describe('state: revoked', () => {
    it('returns revoked for a term with revokedAt set', async () => {
      const revokedDate = new Date('2025-02-01T14:00:00Z');
      setupSelects([
        [{ id: MOCK_PATIENT_ID }],
        [
          {
            id: randomUUID(),
            signedAt: new Date('2025-01-15T10:00:00Z'),
            revokedAt: revokedDate,
            signatureToken: MOCK_TOKEN,
            templateVersion: 1,
            revocationReason: 'Patient requested',
            createdAt: new Date('2025-01-10T10:00:00Z'),
          },
        ],
      ]);

      const supabase = createMockSupabase();
      const result = await getAiConsentStatusImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.consent).toEqual({
          state: 'revoked',
          revokedAt: revokedDate,
          reason: 'Patient requested',
        });
      }
    });

    it('returns revoked with null reason when no reason provided', async () => {
      const revokedDate = new Date('2025-02-01T14:00:00Z');
      setupSelects([
        [{ id: MOCK_PATIENT_ID }],
        [
          {
            id: randomUUID(),
            signedAt: new Date('2025-01-15T10:00:00Z'),
            revokedAt: revokedDate,
            signatureToken: MOCK_TOKEN,
            templateVersion: 1,
            revocationReason: null,
            createdAt: new Date('2025-01-10T10:00:00Z'),
          },
        ],
      ]);

      const supabase = createMockSupabase();
      const result = await getAiConsentStatusImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.consent).toEqual({
          state: 'revoked',
          revokedAt: revokedDate,
          reason: null,
        });
      }
    });
  });
});
