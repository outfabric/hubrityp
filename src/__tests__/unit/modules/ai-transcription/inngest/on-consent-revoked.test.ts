import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AI_TRANSCRIPTION_EVENTS,
  consentRevokedEventSchema,
} from '@/modules/ai-transcription/inngest/events';
import type {
  ConsentRevokedCandidate,
  ConsentRevokedResult,
  HandleConsentRevokedDeps,
} from '@/modules/ai-transcription/inngest/on-consent-revoked';

// ---------------------------------------------------------------------------
// Mock logger — capture log calls to assert what is (and is not) logged.
// ---------------------------------------------------------------------------

const { mockLoggerInfo } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
}));

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: mockLoggerInfo,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Must import after mocks are set up
const { handleConsentRevoked, onConsentRevoked } =
  await import('@/modules/ai-transcription/inngest/on-consent-revoked');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'b2c3d4e5-f6a7-4901-bcde-f12345678901';
const PATIENT_ID = 'c3d4e5f6-a7b8-4012-8def-123456789012';

function buildDeps(rows: ConsentRevokedCandidate[]): HandleConsentRevokedDeps & {
  cancelPendingRow: ReturnType<typeof vi.fn>;
} {
  return {
    findInFlightRows: vi.fn().mockResolvedValue(rows),
    cancelPendingRow: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Inngest function wiring
// ---------------------------------------------------------------------------

describe('onConsentRevoked — wiring', () => {
  it('listens to the correct event name', () => {
    expect(AI_TRANSCRIPTION_EVENTS.CONSENT_REVOKED).toBe('ai-transcription/consent.revoked');
  });

  it('event schema matches the expected shape', () => {
    const payload = {
      termId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
      userId: USER_ID,
      patientId: PATIENT_ID,
      revokedAt: '2024-06-15T12:00:00.000Z',
      reason: 'Patient requested removal of AI features.',
    };
    const parsed = consentRevokedEventSchema.parse(payload);

    expect(parsed.termId).toBe(payload.termId);
    expect(parsed.revokedAt).toBeInstanceOf(Date);
    expect(parsed.reason).toBe(payload.reason);
  });

  it('exports the Inngest function', () => {
    expect(onConsentRevoked).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Handler behavior
// ---------------------------------------------------------------------------

describe('handleConsentRevoked', () => {
  beforeEach(() => {
    mockLoggerInfo.mockClear();
  });

  // (a) pending row → marked cancelled
  it('cancels pending rows', async () => {
    const rows: ConsentRevokedCandidate[] = [{ id: 'tx-1', status: 'pending' }];
    const deps = buildDeps(rows);

    const result: ConsentRevokedResult = await handleConsentRevoked(
      { userId: USER_ID, patientId: PATIENT_ID },
      deps,
    );

    expect(result.cancelled).toBe(1);
    expect(result.skippedMidProcessing).toBe(0);
    expect(deps.cancelPendingRow).toHaveBeenCalledTimes(1);
    expect(deps.cancelPendingRow).toHaveBeenCalledWith('tx-1', USER_ID);
  });

  // (b) transcribing row → unchanged + log line
  it('does not cancel transcribing rows, logs instead', async () => {
    const rows: ConsentRevokedCandidate[] = [{ id: 'tx-2', status: 'transcribing' }];
    const deps = buildDeps(rows);

    const result = await handleConsentRevoked({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result.cancelled).toBe(0);
    expect(result.skippedMidProcessing).toBe(1);
    expect(deps.cancelPendingRow).not.toHaveBeenCalled();

    // Assert log line for mid-processing
    const midProcessingCall = mockLoggerInfo.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)?.event === 'consent_revoked_mid_processing',
    );
    expect(midProcessingCall).toBeDefined();
    expect((midProcessingCall![0] as Record<string, unknown>).transcriptionId).toBe('tx-2');
  });

  // (c) generating row → unchanged + log line
  it('does not cancel generating rows, logs instead', async () => {
    const rows: ConsentRevokedCandidate[] = [{ id: 'tx-3', status: 'generating' }];
    const deps = buildDeps(rows);

    const result = await handleConsentRevoked({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result.cancelled).toBe(0);
    expect(result.skippedMidProcessing).toBe(1);
    expect(deps.cancelPendingRow).not.toHaveBeenCalled();

    const midProcessingCall = mockLoggerInfo.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)?.event === 'consent_revoked_mid_processing',
    );
    expect(midProcessingCall).toBeDefined();
    expect((midProcessingCall![0] as Record<string, unknown>).transcriptionId).toBe('tx-3');
  });

  // (d) ready/reviewed rows → not affected (not returned by query)
  it('does not affect ready/reviewed rows (not returned by findInFlightRows)', async () => {
    // findInFlightRows only returns pending/transcribing/generating
    // so ready/reviewed never reach the handler
    const rows: ConsentRevokedCandidate[] = [];
    const deps = buildDeps(rows);

    const result = await handleConsentRevoked({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result.cancelled).toBe(0);
    expect(result.skippedMidProcessing).toBe(0);
    expect(deps.cancelPendingRow).not.toHaveBeenCalled();
  });

  // Mixed: pending + transcribing + generating
  it('handles mixed statuses correctly', async () => {
    const rows: ConsentRevokedCandidate[] = [
      { id: 'tx-pending', status: 'pending' },
      { id: 'tx-transcribing', status: 'transcribing' },
      { id: 'tx-generating', status: 'generating' },
    ];
    const deps = buildDeps(rows);

    const result = await handleConsentRevoked({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    expect(result.cancelled).toBe(1);
    expect(result.skippedMidProcessing).toBe(2);
    expect(deps.cancelPendingRow).toHaveBeenCalledTimes(1);
    expect(deps.cancelPendingRow).toHaveBeenCalledWith('tx-pending', USER_ID);
  });

  // Logging: does NOT log PII (reason field)
  it('does not log PII — no reason field in any log line', async () => {
    const rows: ConsentRevokedCandidate[] = [{ id: 'tx-1', status: 'pending' }];
    const deps = buildDeps(rows);

    await handleConsentRevoked({ userId: USER_ID, patientId: PATIENT_ID }, deps);

    const serialized = JSON.stringify(mockLoggerInfo.mock.calls);
    expect(serialized).not.toContain('"reason"');
  });
});
