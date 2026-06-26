'use client';

import { useEffect, useRef, useState } from 'react';

import { createBrowserClient } from '@/shared/supabase/client';

import { WAITING_PRESENCE_TTL_MS } from '../lib/presence-constants';

// ---------------------------------------------------------------------------
// Channel / event contract
//
// The psychologist subscribes to the PRIVATE Realtime topic
// `video-room:<roomId>`. A SECURITY DEFINER trigger on `video_rooms` (migration
// 0042) emits a MINIMAL payload `{ room_id, last_seen_at }` on event
// `'presence'` whenever the patient heartbeat (`patient_last_seen_at`) changes.
// Because the trigger fires on `IS DISTINCT FROM`, a departure
// (timestamp -> NULL) ALSO broadcasts, carrying `last_seen_at: null`.
//
// Receipt authorization is enforced by the RLS SELECT policy on
// `realtime.messages` (only the room owner may read its topic) — the channel
// MUST be opened as `private` so supabase-js attaches the access token and the
// server can authorize the subscription. The payload is untrusted transport: we
// only ever record a timestamp (or clear it), never make an authz decision from
// it.
// ---------------------------------------------------------------------------

const PRESENCE_EVENT = 'presence';

/** Channel name for a given room. Derived from the room UUID, never input. */
function videoRoomChannelName(roomId: string): string {
  return `video-room:${roomId}`;
}

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

/**
 * Discriminated result of parsing an untrusted presence broadcast:
 * - `heartbeat`: a fresh liveness timestamp arrived (epoch ms).
 * - `departure`: an explicit `last_seen_at: null` arrived → clear presence now.
 * - `ignore`: malformed / unrecognized payload → make no state change.
 */
export type PresenceSignal =
  | { kind: 'heartbeat'; at: number }
  | { kind: 'departure' }
  | { kind: 'ignore' };

/**
 * Defensive parser for the untrusted broadcast payload. Exported for unit
 * testing the malformed-payload and departure guards. Distinguishes an explicit
 * `last_seen_at: null` (departure) from a missing field or non-object payload
 * (ignore) so a malformed message never clears a legitimately present patient.
 */
export function parsePresencePayload(payload: unknown): PresenceSignal {
  if (typeof payload !== 'object' || payload === null) {
    return { kind: 'ignore' };
  }
  if (!('last_seen_at' in payload)) {
    return { kind: 'ignore' };
  }

  const value: unknown = payload.last_seen_at;

  // Explicit null = the trigger fired on a departure (timestamp -> NULL).
  if (value === null) {
    return { kind: 'departure' };
  }

  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? { kind: 'ignore' } : { kind: 'heartbeat', at: ms };
  }

  // Defensive: a numeric epoch is also acceptable, anything else is malformed.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { kind: 'heartbeat', at: value };
  }

  return { kind: 'ignore' };
}

/** Normalize a server-rendered seed value to epoch milliseconds (or null). */
function toEpochMs(value: Date | string | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Pure freshness check: present iff a known timestamp is within the TTL. */
function isFresh(lastSeenAtMs: number | null, ttlMs: number): boolean {
  return lastSeenAtMs != null && Date.now() - lastSeenAtMs < ttlMs;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseVideoRoomPresenceOptions {
  /** Video room UUID. Comes from server-rendered data, never client input. */
  roomId: string | null | undefined;
  /** Authenticated psychologist's user ID. From the session, never input. */
  userId: string | null | undefined;
  /** Server-rendered `patient_last_seen_at` seed (so an already-present
   * patient shows on first render without waiting for a realtime event). */
  initialLastSeenAt: Date | string | number | null | undefined;
  /** Overridable TTL — defaults to {@link WAITING_PRESENCE_TTL_MS}. Lets unit
   * tests shrink the freshness window to validate auto-clear with fake timers. */
  ttlMs?: number;
  /** Overridable re-evaluation cadence. Defaults to a third of the TTL so the
   * badge auto-clears within one tick of the TTL boundary. */
  evaluationIntervalMs?: number;
}

/**
 * Owner-scoped waiting-room presence for the psychologist's video screen.
 *
 * Seeds presence from the server-rendered `patient_last_seen_at`, then keeps it
 * live via the PRIVATE `video-room:<roomId>` Realtime channel:
 * - each heartbeat refreshes the freshness window;
 * - a departure broadcast (`last_seen_at: null`) clears presence immediately;
 * - a periodic re-evaluation auto-clears presence once the TTL elapses with no
 *   further heartbeats (covers a patient leaving without a beacon).
 *
 * The channel + interval are torn down on unmount or when the ids change. A
 * falsy `roomId`/`userId` is a no-op (no subscription, no interval). The
 * broadcast payload is treated as untrusted: only a timestamp (or null) is
 * recorded — never an authorization decision.
 */
export function useVideoRoomPresence({
  roomId,
  userId,
  initialLastSeenAt,
  ttlMs = WAITING_PRESENCE_TTL_MS,
  evaluationIntervalMs,
}: UseVideoRoomPresenceOptions): boolean {
  const intervalMs = evaluationIntervalMs ?? Math.max(1_000, Math.floor(ttlMs / 3));

  // Latest known heartbeat, read inside the interval without re-subscribing.
  const initialMs = toEpochMs(initialLastSeenAt);
  const lastSeenAtRef = useRef<number | null>(initialMs);
  const [isPatientPresent, setIsPatientPresent] = useState<boolean>(() =>
    isFresh(initialMs, ttlMs),
  );

  useEffect(() => {
    if (!roomId || !userId) {
      return;
    }

    const supabase = createBrowserClient();
    const channel = supabase
      .channel(videoRoomChannelName(roomId), { config: { private: true } })
      .on('broadcast', { event: PRESENCE_EVENT }, ({ payload }: { payload: unknown }) => {
        const signal = parsePresencePayload(payload);
        if (signal.kind === 'ignore') {
          return;
        }
        if (signal.kind === 'departure') {
          lastSeenAtRef.current = null;
          setIsPatientPresent(false);
          return;
        }
        lastSeenAtRef.current = signal.at;
        setIsPatientPresent(isFresh(signal.at, ttlMs));
      })
      .subscribe();

    // Re-evaluate freshness on a cadence so the badge auto-clears after the TTL
    // even when heartbeats simply stop (no departure broadcast received).
    const interval = setInterval(() => {
      setIsPatientPresent(isFresh(lastSeenAtRef.current, ttlMs));
    }, intervalMs);

    return () => {
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [roomId, userId, ttlMs, intervalMs]);

  return isPatientPresent;
}
