import { describe, expect, it } from 'vitest';

import {
  videoRoomInputSchema,
  videoRoomSchema,
  videoTokenInputSchema,
} from '@/modules/telepsicologia/lib/schemas';

// ---------------------------------------------------------------------------
// videoRoomInputSchema
// ---------------------------------------------------------------------------

describe('videoRoomInputSchema', () => {
  it('accepts a valid UUID for session_id', () => {
    const result = videoRoomInputSchema.safeParse({
      session_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID string for session_id', () => {
    const result = videoRoomInputSchema.safeParse({
      session_id: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.session_id?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects an empty string for session_id', () => {
    const result = videoRoomInputSchema.safeParse({ session_id: '' });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.session_id?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a missing session_id', () => {
    const result = videoRoomInputSchema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.session_id?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a numeric session_id', () => {
    const result = videoRoomInputSchema.safeParse({ session_id: 12345 });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.session_id?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// videoTokenInputSchema
// ---------------------------------------------------------------------------

describe('videoTokenInputSchema', () => {
  it('accepts a valid UUID for room_id', () => {
    const result = videoTokenInputSchema.safeParse({
      room_id: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID string for room_id', () => {
    const result = videoTokenInputSchema.safeParse({
      room_id: 'invalid',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.room_id?.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects a missing room_id', () => {
    const result = videoTokenInputSchema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.room_id?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// videoRoomSchema (full row shape)
// ---------------------------------------------------------------------------

describe('videoRoomSchema', () => {
  const validRoom = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    user_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    session_id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    stream_call_id: 'call_abc123',
    patient_token: 'a'.repeat(64),
    patient_jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.sig',
    partner_token: null,
    partner_jwt: null,
    available_from: '2026-01-15T14:00:00Z',
    expires_at: '2026-01-15T16:00:00Z',
    recording_enabled: false,
    recording_consent_signed: false,
    status: 'pending' as const,
    created_at: '2026-01-15T13:00:00Z',
  };

  it('accepts a valid complete room object', () => {
    const result = videoRoomSchema.safeParse(validRoom);

    expect(result.success).toBe(true);
  });

  it('accepts a room with partner_token and partner_jwt populated', () => {
    const result = videoRoomSchema.safeParse({
      ...validRoom,
      partner_token: 'b'.repeat(64),
      partner_jwt: 'eyJhbGciOiJIUzI1NiJ9.partner.sig',
    });

    expect(result.success).toBe(true);
  });

  it('accepts all valid status values', () => {
    for (const status of ['pending', 'active', 'ended', 'expired'] as const) {
      const result = videoRoomSchema.safeParse({ ...validRoom, status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid status value', () => {
    const result = videoRoomSchema.safeParse({
      ...validRoom,
      status: 'cancelled',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID id', () => {
    const result = videoRoomSchema.safeParse({
      ...validRoom,
      id: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an invalid patient_token (wrong length)', () => {
    const result = videoRoomSchema.safeParse({
      ...validRoom,
      patient_token: 'abc123',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an invalid patient_token (non-hex characters)', () => {
    const result = videoRoomSchema.safeParse({
      ...validRoom,
      patient_token: 'g'.repeat(64),
    });

    expect(result.success).toBe(false);
  });

  it('rejects when required fields are missing', () => {
    const result = videoRoomSchema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) return;
    // Should have errors for multiple required fields
    expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it('coerces date strings into Date objects', () => {
    const result = videoRoomSchema.safeParse(validRoom);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.available_from).toBeInstanceOf(Date);
    expect(result.data.expires_at).toBeInstanceOf(Date);
    expect(result.data.created_at).toBeInstanceOf(Date);
  });

  it('accepts nullable recording_enabled and recording_consent_signed', () => {
    const result = videoRoomSchema.safeParse({
      ...validRoom,
      recording_enabled: null,
      recording_consent_signed: null,
    });

    expect(result.success).toBe(true);
  });
});
