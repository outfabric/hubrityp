import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { consentRevokedEventSchema } from '@/modules/ai-transcription/inngest/events';

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
// consentRevokedEventSchema
// ---------------------------------------------------------------------------

describe('consentRevokedEventSchema', () => {
  it('accepts a valid payload', () => {
    const payload = validPayload();
    const result = consentRevokedEventSchema.parse(payload);

    expect(result.termId).toBe(payload.termId);
    expect(result.userId).toBe(payload.userId);
    expect(result.patientId).toBe(payload.patientId);
    expect(result.reason).toBe(payload.reason);
    expect(result.revokedAt).toBeInstanceOf(Date);
  });

  it('rejects missing termId', () => {
    const payload = validPayload();

    delete (payload as Record<string, unknown>)['termId'];

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects reason longer than 500 characters', () => {
    const payload = validPayload();
    payload.reason = 'a'.repeat(501);

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('coerces ISO string to Date for revokedAt', () => {
    const payload = validPayload();
    payload.revokedAt = '2024-06-15T12:00:00.000Z';

    const result = consentRevokedEventSchema.parse(payload);

    expect(result.revokedAt).toBeInstanceOf(Date);
    expect(result.revokedAt.toISOString()).toBe('2024-06-15T12:00:00.000Z');
  });

  it('accepts null reason', () => {
    const payload = { ...validPayload(), reason: null };
    const result = consentRevokedEventSchema.parse(payload);

    expect(result.reason).toBeNull();
  });

  it('rejects invalid UUID for termId', () => {
    const payload = { ...validPayload(), termId: 'not-a-uuid' };

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for userId', () => {
    const payload = { ...validPayload(), userId: 'not-a-uuid' };

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for patientId', () => {
    const payload = { ...validPayload(), patientId: 'not-a-uuid' };

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('accepts reason exactly at 500 characters', () => {
    const payload = { ...validPayload(), reason: 'a'.repeat(500) };
    const result = consentRevokedEventSchema.parse(payload);

    expect(result.reason).toHaveLength(500);
  });
});
