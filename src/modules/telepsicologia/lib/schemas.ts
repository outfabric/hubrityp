import { z } from 'zod';

/**
 * Zod schemas for telepsychology video rooms.
 *
 * Single source of truth for:
 *   - Server Action input validation (create room, generate token)
 *   - Type inference via z.infer (no manual type duplication)
 *
 * These schemas are pure (no Drizzle, no Node-only deps) and edge-safe.
 */

// ---------------------------------------------------------------------------
// Valid status values — mirrors the CHECK constraint in the migration.
// ---------------------------------------------------------------------------

export const VIDEO_ROOM_STATUSES = ['pending', 'active', 'ended', 'expired'] as const;
export type VideoRoomStatus = (typeof VIDEO_ROOM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Input schemas — validated at the Server Action boundary
// ---------------------------------------------------------------------------

/**
 * Input for creating a video room. The caller provides the session ID;
 * `user_id` comes from the authenticated session (never from client input).
 */
export const videoRoomInputSchema = z.object({
  session_id: z.string().uuid({ message: 'session_id must be a valid UUID.' }),
});

export type VideoRoomInput = z.infer<typeof videoRoomInputSchema>;

/**
 * Input for generating a video token (Stream JWT). The caller provides the
 * room ID; ownership is verified server-side via RLS / session.
 */
export const videoTokenInputSchema = z.object({
  room_id: z.string().uuid({ message: 'room_id must be a valid UUID.' }),
});

export type VideoTokenInput = z.infer<typeof videoTokenInputSchema>;

// ---------------------------------------------------------------------------
// Full row schema — mirrors the `video_rooms` table columns exactly.
// Used for type inference when reading rows from the DB.
// ---------------------------------------------------------------------------

export const videoRoomSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  session_id: z.string().uuid(),
  stream_call_id: z.string().min(1),
  patient_token: z.string().length(64).regex(/^[0-9a-f]{64}$/),
  patient_jwt: z.string().min(1),
  partner_token: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  partner_jwt: z.string().min(1).nullable(),
  available_from: z.coerce.date(),
  expires_at: z.coerce.date(),
  recording_enabled: z.boolean().nullable(),
  recording_consent_signed: z.boolean().nullable(),
  status: z.enum(VIDEO_ROOM_STATUSES),
  created_at: z.coerce.date(),
});

export type VideoRoom = z.infer<typeof videoRoomSchema>;
