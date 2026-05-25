import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateAiConsentTermImpl } from '@/modules/patients/server/generate-ai-consent';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Track inserted rows so tests can inspect them
const insertedRows: Record<string, unknown>[] = [];

/**
 * The generate action issues two sequential selects:
 *   1. Patient ownership check  → returns patient row or []
 *   2. Existing term check      → returns existing term row or []
 *
 * We use a call-counter driven by module-level state to differentiate them.
 */
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
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        insertedRows.push(row);
        return {
          returning: vi.fn(() => Promise.resolve([{ id: randomUUID() }])),
        };
      }),
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
const OTHER_PATIENT_ID = randomUUID();

function createMockSupabase(overrides?: { authenticated?: boolean; userId?: string }) {
  const { authenticated = true, userId = MOCK_USER_ID } = overrides ?? {};

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authenticated ? { id: userId } : null },
      }),
    },
  } as unknown as Parameters<typeof generateAiConsentTermImpl>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateAiConsentTermImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.length = 0;
    selectCallIndex = 0;
    selectResults = [];
  });

  describe('authentication', () => {
    it('returns UNAUTHORIZED when user is anonymous', async () => {
      const supabase = createMockSupabase({ authenticated: false });

      const result = await generateAiConsentTermImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    });
  });

  describe('input validation', () => {
    it('rejects malformed patientId', async () => {
      const supabase = createMockSupabase();

      const result = await generateAiConsentTermImpl(supabase, { patientId: 'not-a-uuid' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects missing patientId', async () => {
      const supabase = createMockSupabase();

      const result = await generateAiConsentTermImpl(supabase, {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('patient ownership', () => {
    it('returns NOT_FOUND for a patient belonging to another user', async () => {
      // First select (patient ownership) returns empty — patient not found for this user
      selectResults = [[]];

      const supabase = createMockSupabase();
      const result = await generateAiConsentTermImpl(supabase, { patientId: OTHER_PATIENT_ID });

      expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
      // Verify the error message does NOT leak existence information
      expect(JSON.stringify(result)).not.toContain('another');
      expect(JSON.stringify(result)).not.toContain('exists');
    });
  });

  describe('duplicate prevention', () => {
    it('returns ALREADY_ACTIVE when a pending term exists', async () => {
      // First select: patient found; Second select: existing pending term found
      selectResults = [[{ id: MOCK_PATIENT_ID }], [{ id: randomUUID() }]];

      const supabase = createMockSupabase();
      const result = await generateAiConsentTermImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result).toEqual({ ok: false, error: 'ALREADY_ACTIVE' });
    });

    it('returns ALREADY_ACTIVE when a signed active term exists', async () => {
      // First select: patient found; Second select: existing signed term found
      selectResults = [[{ id: MOCK_PATIENT_ID }], [{ id: randomUUID() }]];

      const supabase = createMockSupabase();
      const result = await generateAiConsentTermImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result).toEqual({ ok: false, error: 'ALREADY_ACTIVE' });
    });
  });

  describe('success path', () => {
    it('allows new generation when previous term was revoked (no non-revoked term)', async () => {
      // First select: patient found; Second select: no non-revoked term
      selectResults = [[{ id: MOCK_PATIENT_ID }], []];

      const supabase = createMockSupabase();
      const result = await generateAiConsentTermImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.publicUrl).toMatch(/^\/termo\/.+$/);
        expect(result.expiresAt).toBeInstanceOf(Date);
        // Token expiry should be ~7 days from now
        const sevenDaysFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;
        expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
        expect(result.expiresAt.getTime()).toBeLessThanOrEqual(sevenDaysFromNow + 1000);
      }
    });

    it('returns a token that matches the inserted DB row token', async () => {
      selectResults = [[{ id: MOCK_PATIENT_ID }], []];

      const supabase = createMockSupabase();
      const result = await generateAiConsentTermImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Extract token from the publicUrl
        const token = result.publicUrl.replace('/termo/', '');
        expect(token.length).toBeGreaterThan(0);

        // Verify the inserted row contains the same token
        expect(insertedRows).toHaveLength(1);
        expect(insertedRows[0]).toMatchObject({
          kind: 'ai_recording',
          signatureToken: token,
          revocationTakesEffectImmediately: true,
          templateVersion: 1,
        });
      }
    });

    it('inserts row with correct template snapshot', async () => {
      selectResults = [[{ id: MOCK_PATIENT_ID }], []];

      const supabase = createMockSupabase();
      const result = await generateAiConsentTermImpl(supabase, { patientId: MOCK_PATIENT_ID });

      expect(result.ok).toBe(true);
      expect(insertedRows).toHaveLength(1);
      const row = insertedRows[0]!;
      expect(row.templateSnapshot).toHaveProperty('version', 1);
      expect(row.templateSnapshot).toHaveProperty('title');
      expect(row.templateSnapshot).toHaveProperty('sections');
    });
  });
});
