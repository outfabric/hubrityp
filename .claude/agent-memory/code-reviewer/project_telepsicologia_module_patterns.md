---
name: project-telepsicologia-module-patterns
description: Stream.io video module security/design patterns, Realtime channel authorization, token-gated public routes, transaction gaps, first-arrival detection technique
metadata:
  type: project
---

# Telepsicologia module patterns

## Token-gated public routes (`/api/video/join`, `/api/video/depart`, `/api/video/log`)

All three patient-facing video endpoints are **intentionally public** (no Supabase auth). Patients are not Supabase users; the 64-char hex token (256 bits of entropy) IS the authorization credential. Pattern:

- `classifyPath()` falls through to `'public'` for `/api/video/*` (confirmed in middleware.ts)
- Drizzle `db` client (app-level, bypasses RLS) is the correct client — patients can't hold a Supabase JWT
- Rate limit applied **before** any DB work (10 req/min per IP, in-process, per instance)
- Zod validates `{ token }` (length 64, `/^[a-f0-9]+$/`) before any business logic
- Responses are opaque: no IDs, tokens, JWTs, PII, existence oracles in error cases

**Why:** This design was reviewed and accepted in the waiting-room arrival signal change (2026-06-26). Searching for `getUser()` in these routes is a false positive — they legitimately don't use Supabase auth.

## Waiting-room arrival signal (2026-06-26)

### Two-column design on `video_rooms`
- `patient_waiting_at` — IMMUTABLE first-arrival anchor (COALESCE sets once, never advanced). Used for wait-time audit.
- `patient_last_seen_at` — MUTABLE liveness heartbeat (advanced on every waiting poll, cleared to NULL on departure). Watched by Realtime trigger.

### First-arrival detection via COALESCE + RETURNING
Single-statement atomic check-and-set pattern:
```sql
UPDATE video_rooms
SET patient_last_seen_at = now(),
    patient_waiting_at = COALESCE(patient_waiting_at, now())
WHERE (patient_token = :token OR partner_token = :token)
RETURNING (patient_waiting_at = patient_last_seen_at) AS is_first_arrival
```
`RETURNING` sees NEW values; on first arrival both are `now()` (stable within transaction) → TRUE. Subsequent polls: `patient_waiting_at` is older than the new `patient_last_seen_at` → FALSE. Safe under concurrent first-arrival races due to PostgreSQL row-level locking.

**Known gap (flagged as HIGH in review-1):** The UPDATE and the subsequent `video_session_logs` INSERT are NOT in the same transaction. If the INSERT fails after the UPDATE commits, `patient_waiting_at` is stamped but no audit log exists (permanent, since subsequent polls get `is_first_arrival = false`). Should be wrapped in `db.transaction(async (tx) => { ... })`.

**Known gap (flagged as MEDIUM in review-1):** Join route UPDATE lacks `AND status = 'pending'` guard (unlike the depart route). In a TOCTOU race, the UPDATE fires on an already-active room — no security impact, but noisy Realtime broadcast.

### SECURITY DEFINER trigger for Realtime broadcast
- Trigger function `broadcast_video_room_presence` in `public` schema, `SECURITY DEFINER`, `SET search_path = ''`
- Fires on `video_rooms` UPDATE WHEN `patient_last_seen_at IS DISTINCT FROM OLD.patient_last_seen_at`
- Broadcasts minimal JSONB `{ room_id, last_seen_at }` — deliberately NOT `realtime.broadcast_changes` (would expose `patient_jwt`, `patient_token`, `partner_jwt`, `partner_token` from the full row)
- Migration wrapped in `DO $$ … IF EXISTS (realtime schema / realtime.send) … $$` guard for Testcontainers/CI compatibility

### Realtime channel authorization
- Channel name: `video-room:<roomId>` (private, requires Supabase auth token)
- RLS SELECT policy on `realtime.messages`: `vr.user_id = auth.uid() AND realtime.topic() = 'video-room:' || vr.id::text AND extension = 'broadcast'`
- Hook creates channel with `{ config: { private: true } }` — required for RLS enforcement
- Payload treated as untrusted by the hook (only records timestamp/null, never makes authz decision)

### Departure beacon
- `pagehide` (not `beforeunload`/`unload`) — mobile reliable, bfcache-safe
- `navigator.sendBeacon` — survives page teardown; cannot set custom headers → token in body
- Depart route guards: `status = 'pending'` prevents clearing liveness after admission; `IS NOT NULL` makes duplicate beacons idempotent (zero-row update)

### Pre-existing concern (not introduced by this diff)
The video page (`/sessao/[id]/video/page.tsx`) uses `.select()` (all columns) on `video_rooms`, which includes `patientJwt`, `partnerJwt`, `patientToken`, `partnerToken` in the RSC payload passed to client components. These are the patient/partner credentials for the Stream call — the psychologist's client does not need them.

## Test mocking patterns (telepsicologia)

- Stream SDK in unit/component tests: `vi.mock('@stream-io/video-react-sdk', () => ({ SpeakerLayout: () => <div/>, useCall: () => ({ on: vi.fn(() => vi.fn()) }) }))`
- `useVideoRoomPresence` in badge tests: `vi.mock('@/modules/telepsicologia/hooks/use-video-room-presence', () => ({ useVideoRoomPresence: (): boolean => mockPresence }))`
- Integration tests: `vi.mock('@/modules/telepsicologia/server/stream-client', () => ({ getStreamClient: () => ({ upsertUsers }) }))` for routes that import Stream client at module level
- E2E seeded suite: block Stream traffic with `page.route(/\.(stream-io-api\.com|getstream\.io)/, ...)` — client stays in `CallingState.IDLE` (lobby), reachable surface for assertions
