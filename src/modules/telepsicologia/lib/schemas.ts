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

// The canonical `VideoRoom` type is the Drizzle `$inferSelect` type from
// `@/shared/db/schema/telepsicologia/tables`. It is NOT re-exported from
// this file to avoid a naming collision (Drizzle uses camelCase, Zod
// would use snake_case). Consumers that need the `VideoRoom` type should
// import it from the module barrel (`@/modules/telepsicologia`) or from
// `@/shared/db/schema/telepsicologia/tables` directly.
