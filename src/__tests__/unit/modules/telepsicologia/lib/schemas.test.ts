import { describe, expect, it } from 'vitest';

import {
  videoRoomInputSchema,
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
// videoRoomSchema was removed (HIGH #1 review fix): the canonical VideoRoom
// type is now the Drizzle $inferSelect type from tables.ts, not a Zod schema.
// Tests that validated the Zod row schema are no longer needed — the Drizzle
// type is structurally validated via the integration test suite.
// ---------------------------------------------------------------------------
