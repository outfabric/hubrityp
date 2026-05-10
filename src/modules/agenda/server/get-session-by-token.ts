import 'server-only';

import { eq } from 'drizzle-orm';

import { isTokenExpired } from '@/modules/agenda/lib/confirmation-token';
import type { SessionStatus } from '@/modules/agenda/lib/session-status';
import { db } from '@/shared/db/client';
import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Public-safe session data exposed by the confirmation page. */
export interface PublicSessionData {
  sessionId: string;
  date: Date;
  durationMinutes: number;
  psychologistName: string;
  locationName: string | null;
  locationAddress: string | null;
  locationArrivalInstructions: string | null;
  locationType: string | null;
  modality: string | null;
}

/** Typed token resolution states. */
export type TokenState = 'valid' | 'expired' | 'already_responded' | 'cancelled' | 'invalid';

export type GetSessionByTokenResult =
  | { state: 'valid'; data: PublicSessionData }
  | { state: 'expired' }
  | { state: 'already_responded' }
  | { state: 'cancelled' }
  | { state: 'invalid' };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Looks up a session by its confirmation token for the public confirmation page.
 *
 * This function runs WITHOUT authentication -- the token itself is the
 * authorization credential (256 bits of entropy). It uses Drizzle's app-level
 * `db` client which bypasses RLS (the integration test environment runs as
 * superuser; in production, the connection string is the service-role pool).
 *
 * Returns only public-safe fields: date, time, psychologist name, location.
 * Returns typed states based on the session's current condition:
 *   - `valid`:             token is usable, session is confirmable
 *   - `expired`:           session start_at has passed
 *   - `already_responded`: patient already confirmed or declined
 *   - `cancelled`:         session was cancelled by the psychologist
 *   - `invalid`:           token does not match any session
 */
export async function getSessionByTokenImpl(token: string): Promise<GetSessionByTokenResult> {
  // Validate token format: must be a base64url string (43 chars for 32 bytes)
  if (!token || token.length < 1) {
    return { state: 'invalid' };
  }

  // Query session by confirmation_token, joining profiles for psychologist name
  // and locations for location data.
  const rows = await db
    .select({
      sessionId: sessions.id,
      startAt: sessions.startAt,
      durationMinutes: sessions.durationMinutes,
      status: sessions.status,
      confirmedAt: sessions.confirmedAt,
      cancelledBy: sessions.cancelledBy,
      deletedAt: sessions.deletedAt,
      modality: sessions.modality,
      psychologistName: profiles.fullName,
      locationName: locations.name,
      locationAddress: locations.address,
      locationArrivalInstructions: locations.arrivalInstructions,
      locationType: locations.type,
    })
    .from(sessions)
    .innerJoin(profiles, eq(profiles.userId, sessions.userId))
    .leftJoin(locations, eq(locations.id, sessions.locationId))
    .where(eq(sessions.confirmationToken, token))
    .limit(1);

  const row = rows[0];

  // Token not found
  if (!row) {
    return { state: 'invalid' };
  }

  // Soft-deleted sessions are treated as invalid
  if (row.deletedAt) {
    return { state: 'invalid' };
  }

  const status = row.status as SessionStatus;

  // Session was cancelled — distinguish who cancelled it.
  // If the patient cancelled via the public page, show "already responded"
  // (the patient already acted on this link). If the psychologist cancelled,
  // show the "cancelled" state with a different message.
  if (status === 'cancelled') {
    if (row.cancelledBy === 'patient') {
      return { state: 'already_responded' };
    }
    return { state: 'cancelled' };
  }

  // Patient already confirmed or in a terminal state (confirmed, done, no_show)
  if (
    row.confirmedAt !== null ||
    status === 'confirmed' ||
    status === 'done' ||
    status === 'no_show'
  ) {
    return { state: 'already_responded' };
  }

  // Token expired -- session has started or passed
  if (isTokenExpired(row.startAt)) {
    return { state: 'expired' };
  }

  // Token is valid and session is confirmable (status = scheduled)
  return {
    state: 'valid',
    data: {
      sessionId: row.sessionId,
      date: row.startAt,
      durationMinutes: row.durationMinutes,
      psychologistName: row.psychologistName,
      locationName: row.locationName,
      locationAddress: row.locationAddress,
      locationArrivalInstructions: row.locationArrivalInstructions,
      locationType: row.locationType,
      modality: row.modality,
    },
  };
}
