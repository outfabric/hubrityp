import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { revokeAiConsentTermImpl } from '@/modules/patients/server/revoke-ai-consent';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResult: Record<string, unknown>[] = [];
let updateCalled = false;
let updateSetValues: Record<string, unknown> | null = null;

// Use vi.hoisted so the mock function is available before vi.mock hoists
const { mockInngestSend } = vi.hoisted(() => ({
  mockInngestSend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResult)),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateCalled = true;
        updateSetValues = values;
        return {
          where: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
  },
}));

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = randomUUID();
const MOCK_PATIENT_ID = randomUUID();
const MOCK_TERM_ID = randomUUID();

function createMockSupabase(overrides?: { authenticated?: boolean }) {
  const { authenticated = true } = overrides ?? {};

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authenticated ? { id: MOCK_USER_ID } : null },
      }),
    },
  } as unknown as Parameters<typeof revokeAiConsentTermImpl>[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('revokeAiConsentTermImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResult = [];
    updateCalled = false;
    updateSetValues = null;
    mockInngestSend.mockResolvedValue(undefined);
  });

  describe('authentication', () => {
    it('returns UNAUTHORIZED when user is anonymous', async () => {
      const supabase = createMockSupabase({ authenticated: false });

      const result = await revokeAiConsentTermImpl(supabase, {
        patientId: MOCK_PATIENT_ID,
        reason: null,
      });

      expect(result).toEqual({ ok: false, error: 'UNAUTHORIZED' });
    });
  });

  describe('input validation', () => {
    it('rejects reason over 500 chars', async () => {
      const supabase = createMockSupabase();
      const longReason = 'a'.repeat(501);

      const result = await revokeAiConsentTermImpl(supabase, {
        patientId: MOCK_PATIENT_ID,
        reason: longReason,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('VALIDATION_ERROR');
      }
    });

    it('accepts reason of exactly 500 chars', async () => {
      selectResult = [{ id: MOCK_TERM_ID }];
      const supabase = createMockSupabase();

      const result = await revokeAiConsentTermImpl(supabase, {
        patientId: MOCK_PATIENT_ID,
        reason: 'a'.repeat(500),
      });

      // Should proceed past validation (may succeed or fail on DB, not on validation)
      expect(result.ok === false && result.error === 'VALIDATION_ERROR').toBe(false);
    });
  });

  describe('no active term', () => {
    it('returns NOT_FOUND when no active ai_recording term exists', async () => {
      selectResult = [];
      const supabase = createMockSupabase();

      const result = await revokeAiConsentTermImpl(supabase, {
        patientId: MOCK_PATIENT_ID,
        reason: null,
      });

      expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
    });
  });

  describe('success path', () => {
    it('updates revoked_at and dispatches Inngest event', async () => {
      selectResult = [{ id: MOCK_TERM_ID }];
      const supabase = createMockSupabase();

      const result = await revokeAiConsentTermImpl(supabase, {
        patientId: MOCK_PATIENT_ID,
        reason: 'Patient requested revocation',
      });

      expect(result).toEqual({ ok: true });
      expect(updateCalled).toBe(true);
      expect(updateSetValues).toHaveProperty('revocationReason', 'Patient requested revocation');

      // Verify Inngest event was sent
      expect(mockInngestSend).toHaveBeenCalledOnce();
      const sendCall = mockInngestSend.mock.calls[0]![0] as Record<string, unknown>;
      expect(sendCall.name).toBe('ai-transcription/consent.revoked');
      const sendData = sendCall.data as Record<string, unknown>;
      expect(sendData).toMatchObject({
        termId: MOCK_TERM_ID,
        userId: MOCK_USER_ID,
        patientId: MOCK_PATIENT_ID,
        reason: 'Patient requested revocation',
      });
    });

    it('returns ok:true even when inngest.send throws', async () => {
      selectResult = [{ id: MOCK_TERM_ID }];
      mockInngestSend.mockRejectedValue(new Error('Inngest is down'));
      const supabase = createMockSupabase();

      const result = await revokeAiConsentTermImpl(supabase, {
        patientId: MOCK_PATIENT_ID,
        reason: null,
      });

      // DB update still completes, user receives ok:true
      expect(result).toEqual({ ok: true });
      expect(updateCalled).toBe(true);
    });

    it('logs inngest failure without PII', async () => {
      selectResult = [{ id: MOCK_TERM_ID }];
      mockInngestSend.mockRejectedValue(new Error('connection refused'));
      const supabase = createMockSupabase();

      await revokeAiConsentTermImpl(supabase, {
        patientId: MOCK_PATIENT_ID,
        reason: 'Patient requested revocation',
      });

      // Access the mocked logger via dynamic import to verify log output.
      // The module is already mocked by vi.mock above — this just retrieves it.
      const loggerModule = await import('@/shared/lib/logger');
      const mockedError = vi.mocked(loggerModule.logger.error);
      expect(mockedError).toHaveBeenCalledOnce();

      // Verify the log contains event identifier but no PII
      const logCall = mockedError.mock.calls[0]!;
      const logData = logCall[0] as Record<string, unknown>;
      expect(logData.event).toBe('inngest_send_failed');
      expect(logData.termId).toBe(MOCK_TERM_ID);
      // Ensure no patient name, email, phone, reason (PII) in the log
      const logString = JSON.stringify(logData);
      expect(logString).not.toContain('Patient requested revocation');
      expect(logString).not.toContain('email');
      expect(logString).not.toContain('phone');
      expect(logString).not.toContain('cpf');
    });
  });
});
