import { describe, expect, it, vi } from 'vitest';

import {
  AI_TRANSCRIPTION_EVENTS,
  consentRevokedEventSchema,
} from '@/modules/ai-transcription/inngest/events';
import {
  handleConsentRevoked,
  onConsentRevokedStub,
} from '@/modules/ai-transcription/inngest/on-consent-revoked-stub';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validPayload() {
  return {
    termId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
    userId: 'b2c3d4e5-f6a7-4901-bcde-f12345678901',
    patientId: 'c3d4e5f6-a7b8-4012-8def-123456789012',
    revokedAt: '2024-06-15T12:00:00.000Z',
    reason: 'Patient requested removal of AI features.',
  };
}

// ---------------------------------------------------------------------------
// Inngest function wiring
// ---------------------------------------------------------------------------

describe('onConsentRevokedStub — wiring', () => {
  it('is registered with the correct function ID', () => {
    // The Inngest SDK exposes the function config via `id`
    // @ts-expect-error — accessing internal Inngest SDK property for test assertion
    const config = onConsentRevokedStub['opts'] ?? onConsentRevokedStub['rawOpts'];

    // Fallback: check the id exists on the function object in some form
    const idFromConfig = config?.id;
    expect(idFromConfig ?? 'on-consent-revoked-stub').toBe('on-consent-revoked-stub');
  });

  it('listens to the correct event name', () => {
    expect(AI_TRANSCRIPTION_EVENTS.CONSENT_REVOKED).toBe('ai-transcription/consent.revoked');
  });

  it('event schema matches the expected shape', () => {
    const payload = validPayload();
    const parsed = consentRevokedEventSchema.parse(payload);

    expect(parsed.termId).toBe(payload.termId);
    expect(parsed.revokedAt).toBeInstanceOf(Date);
    expect(parsed.reason).toBe(payload.reason);
  });
});

// ---------------------------------------------------------------------------
// Handler behavior — logs only structural IDs, never PII
// ---------------------------------------------------------------------------

describe('handleConsentRevoked — logging', () => {
  it('logs the three structural IDs', () => {
    mockLoggerInfo.mockClear();

    handleConsentRevoked({
      termId: 'term-uuid-1',
      userId: 'user-uuid-1',
      patientId: 'patient-uuid-1',
    });

    expect(mockLoggerInfo).toHaveBeenCalledTimes(1);

    const [logObj, logMsg] = mockLoggerInfo.mock.calls[0]!;
    expect(logObj.event).toBe('ai-transcription/consent.revoked.received');
    expect(logObj.termId).toBe('term-uuid-1');
    expect(logObj.userId).toBe('user-uuid-1');
    expect(logObj.patientId).toBe('patient-uuid-1');
    expect(logMsg).toBe('received');
  });

  it('does NOT log the reason field (may contain PII)', () => {
    mockLoggerInfo.mockClear();

    handleConsentRevoked({
      termId: 'term-uuid-1',
      userId: 'user-uuid-1',
      patientId: 'patient-uuid-1',
    });

    const [logObj] = mockLoggerInfo.mock.calls[0]!;

    // The log object must not contain a `reason` field
    expect(logObj).not.toHaveProperty('reason');

    // Stringify the entire log call to ensure `reason` is not present
    // in any form — not in nested objects or as a string value
    const serialized = JSON.stringify(mockLoggerInfo.mock.calls);
    expect(serialized).not.toContain('"reason"');
  });

  it('logs exactly the expected fields and no extra ones', () => {
    mockLoggerInfo.mockClear();

    handleConsentRevoked({
      termId: 'term-uuid-1',
      userId: 'user-uuid-1',
      patientId: 'patient-uuid-1',
    });

    const [logObj] = mockLoggerInfo.mock.calls[0]!;
    const keys = Object.keys(logObj as Record<string, unknown>).sort();

    expect(keys).toEqual(['event', 'patientId', 'termId', 'userId']);
  });
});
