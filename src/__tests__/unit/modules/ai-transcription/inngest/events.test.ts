import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  audioUploadedEventSchema,
  consentRevokedEventSchema,
  recordingCompletedEventSchema,
} from '@/modules/ai-transcription/inngest/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validConsentRevokedPayload() {
  return {
    termId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
    userId: 'b2c3d4e5-f6a7-4901-bcde-f12345678901',
    patientId: 'c3d4e5f6-a7b8-4012-8def-123456789012',
    revokedAt: '2024-06-15T12:00:00.000Z',
    reason: 'Patient requested removal of AI features.',
  };
}

function validAudioUploadedPayload() {
  return {
    transcriptionId: 'd4e5f6a7-b8c9-4123-9012-345678901234',
    userId: 'b2c3d4e5-f6a7-4901-bcde-f12345678901',
    patientId: 'c3d4e5f6-a7b8-4012-8def-123456789012',
    source: 'manual_upload' as const,
  };
}

function validRecordingCompletedPayload() {
  return {
    userId: 'b2c3d4e5-f6a7-4901-bcde-f12345678901',
    patientId: 'c3d4e5f6-a7b8-4012-8def-123456789012',
    sessionId: 'e5f6a7b8-c9d0-4234-8123-456789012345',
    streamRecordingUrl: 'https://stream.example.com/recordings/abc123.mp4',
    streamCallId: 'call_abc123xyz',
  };
}

// ---------------------------------------------------------------------------
// consentRevokedEventSchema
// ---------------------------------------------------------------------------

describe('consentRevokedEventSchema', () => {
  it('accepts a valid payload', () => {
    const payload = validConsentRevokedPayload();
    const result = consentRevokedEventSchema.parse(payload);

    expect(result.termId).toBe(payload.termId);
    expect(result.userId).toBe(payload.userId);
    expect(result.patientId).toBe(payload.patientId);
    expect(result.reason).toBe(payload.reason);
    expect(result.revokedAt).toBeInstanceOf(Date);
  });

  it('rejects missing termId', () => {
    const payload = validConsentRevokedPayload();

    delete (payload as Record<string, unknown>)['termId'];

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects reason longer than 500 characters', () => {
    const payload = validConsentRevokedPayload();
    payload.reason = 'a'.repeat(501);

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('coerces ISO string to Date for revokedAt', () => {
    const payload = validConsentRevokedPayload();
    payload.revokedAt = '2024-06-15T12:00:00.000Z';

    const result = consentRevokedEventSchema.parse(payload);

    expect(result.revokedAt).toBeInstanceOf(Date);
    expect(result.revokedAt.toISOString()).toBe('2024-06-15T12:00:00.000Z');
  });

  it('accepts null reason', () => {
    const payload = { ...validConsentRevokedPayload(), reason: null };
    const result = consentRevokedEventSchema.parse(payload);

    expect(result.reason).toBeNull();
  });

  it('rejects invalid UUID for termId', () => {
    const payload = { ...validConsentRevokedPayload(), termId: 'not-a-uuid' };

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for userId', () => {
    const payload = { ...validConsentRevokedPayload(), userId: 'not-a-uuid' };

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for patientId', () => {
    const payload = { ...validConsentRevokedPayload(), patientId: 'not-a-uuid' };

    expect(() => consentRevokedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('accepts reason exactly at 500 characters', () => {
    const payload = { ...validConsentRevokedPayload(), reason: 'a'.repeat(500) };
    const result = consentRevokedEventSchema.parse(payload);

    expect(result.reason).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// audioUploadedEventSchema
// ---------------------------------------------------------------------------

describe('audioUploadedEventSchema', () => {
  it('accepts a valid manual_upload payload', () => {
    const payload = validAudioUploadedPayload();
    const result = audioUploadedEventSchema.parse(payload);

    expect(result.transcriptionId).toBe(payload.transcriptionId);
    expect(result.userId).toBe(payload.userId);
    expect(result.patientId).toBe(payload.patientId);
    expect(result.source).toBe('manual_upload');
  });

  it('accepts a valid video_session payload', () => {
    const payload = { ...validAudioUploadedPayload(), source: 'video_session' as const };
    const result = audioUploadedEventSchema.parse(payload);

    expect(result.source).toBe('video_session');
  });

  it('rejects missing transcriptionId', () => {
    const payload: Record<string, unknown> = { ...validAudioUploadedPayload() };
    delete payload['transcriptionId'];

    expect(() => audioUploadedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects missing userId', () => {
    const payload: Record<string, unknown> = { ...validAudioUploadedPayload() };
    delete payload['userId'];

    expect(() => audioUploadedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects missing patientId', () => {
    const payload: Record<string, unknown> = { ...validAudioUploadedPayload() };
    delete payload['patientId'];

    expect(() => audioUploadedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects missing source', () => {
    const payload: Record<string, unknown> = { ...validAudioUploadedPayload() };
    delete payload['source'];

    expect(() => audioUploadedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for transcriptionId', () => {
    const payload = { ...validAudioUploadedPayload(), transcriptionId: 'not-a-uuid' };

    expect(() => audioUploadedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for userId', () => {
    const payload = { ...validAudioUploadedPayload(), userId: 'not-a-uuid' };

    expect(() => audioUploadedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for patientId', () => {
    const payload = { ...validAudioUploadedPayload(), patientId: 'not-a-uuid' };

    expect(() => audioUploadedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects an invalid source value', () => {
    const payload = { ...validAudioUploadedPayload(), source: 'phone_call' };

    expect(() => audioUploadedEventSchema.parse(payload)).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// recordingCompletedEventSchema
// ---------------------------------------------------------------------------

describe('recordingCompletedEventSchema', () => {
  it('accepts a valid payload with a session ID', () => {
    const payload = validRecordingCompletedPayload();
    const result = recordingCompletedEventSchema.parse(payload);

    expect(result.userId).toBe(payload.userId);
    expect(result.patientId).toBe(payload.patientId);
    expect(result.sessionId).toBe(payload.sessionId);
    expect(result.streamRecordingUrl).toBe(payload.streamRecordingUrl);
    expect(result.streamCallId).toBe(payload.streamCallId);
  });

  it('accepts a valid payload with null sessionId', () => {
    const payload = { ...validRecordingCompletedPayload(), sessionId: null };
    const result = recordingCompletedEventSchema.parse(payload);

    expect(result.sessionId).toBeNull();
  });

  it('rejects missing userId', () => {
    const payload: Record<string, unknown> = { ...validRecordingCompletedPayload() };
    delete payload['userId'];

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects missing patientId', () => {
    const payload: Record<string, unknown> = { ...validRecordingCompletedPayload() };
    delete payload['patientId'];

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects missing streamRecordingUrl', () => {
    const payload: Record<string, unknown> = { ...validRecordingCompletedPayload() };
    delete payload['streamRecordingUrl'];

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects missing streamCallId', () => {
    const payload: Record<string, unknown> = { ...validRecordingCompletedPayload() };
    delete payload['streamCallId'];

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for userId', () => {
    const payload = { ...validRecordingCompletedPayload(), userId: 'not-a-uuid' };

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for patientId', () => {
    const payload = { ...validRecordingCompletedPayload(), patientId: 'not-a-uuid' };

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid UUID for sessionId', () => {
    const payload = { ...validRecordingCompletedPayload(), sessionId: 'not-a-uuid' };

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects invalid URL for streamRecordingUrl', () => {
    const payload = {
      ...validRecordingCompletedPayload(),
      streamRecordingUrl: 'not-a-valid-url',
    };

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });

  it('rejects empty string for streamCallId', () => {
    const payload = { ...validRecordingCompletedPayload(), streamCallId: '' };

    expect(() => recordingCompletedEventSchema.parse(payload)).toThrow(ZodError);
  });
});
