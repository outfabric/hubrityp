## Context

Online telepsychology sessions run on Stream.io video. The lifecycle of a room is tracked in `video_rooms` (`reserved` → `pending` → `active` → `ended`/`expired`).

Current waiting-room flow:

- **Patient** (`waiting-room-view.tsx`) opens their token link and polls `POST /api/video/join` every 10s. While `room.status === 'pending'` the handler returns `{ status: 'waiting' }` and **deliberately withholds the Stream JWT** — the JWT is only returned when `status === 'active'`. This is a security control (route header comment: "Stream JWT is ONLY returned when the room status is 'active' … prevents pre-admission call join"). Consequence: the patient is invisible to Stream during the wait.
- **Psychologist** (`in-call-view.tsx:97`) shows the "Paciente aguardando" badge + "Admitir" button when `room.status === 'pending' && participantCount <= 1`. But `room` is a **static** server-rendered prop (passed through `video-call-client.tsx`, never re-fetched/subscribed), and `pending` is the default state of every room from the moment it is minted (~1h early by `auto-create-room`). So the badge shows whenever the psychologist is alone in any pending room — there is **no real arrival signal**.

The `participantCount` heuristic is a fossil from an earlier design that assumed the patient would enter Stream pre-admission; the poll-only patient flow silently invalidated that assumption. The stale comment in `in-call-view.tsx` still describes that dead design.

Audit gap: `video_session_logs` records `patient_joined` only at admit time (`admit-patient.ts`), so wait duration is not measurable.

A set-once "arrival flag" is insufficient — it leaves three gaps: (a) patient arrives then leaves → badge latched forever; (b) early arrive + immediate leave → permanent false positive; (c) `room.status` is a static prop the admit flow never refreshes, and an arrival-only broadcast never signals the `active` transition, so the badge can survive admission. The fix is a **liveness heartbeat with a staleness TTL**, not a latch.

Constraints:

- Keep the patient OUT of Stream until admission (preserve the existing security control and avoid Stream per-participant-minute billing).
- The psychologist is a real authenticated Supabase user; the patient is anonymous (token is the only credential).
- `video_rooms` already has owner-scoped RLS (`auth.uid() = user_id`) and holds **sensitive credentials**: `patient_jwt`, `patient_token`, `partner_jwt`, `partner_token`.
- Project conventions (CLAUDE.md): schema-per-domain (`tables.ts` + `policies.ts` + `index.ts`), RLS + per-operation policies mandatory, manual RLS SQL appended to Drizzle migrations (migrations README), funneled env access, module barrel, edge-safe rules.

The repo already uses Supabase Realtime two ways: `notifications` via **Postgres Changes** (user-authenticated, RLS-scoped, `user_id=eq.<id>` filter — `use-notifications-realtime.ts`, migration `0039`) and `ai-transcription` via **server-sent Broadcast** on a public `user:<uuid>` channel (system→user, `broadcast.ts`).

## Goals / Non-Goals

**Goals:**

- Record real patient arrival AND liveness server-side on the `waiting` branch of `/api/video/join` (set-once `patient_waiting_at` for audit; per-poll `patient_last_seen_at` for liveness).
- Surface patient **presence** to the owning psychologist **live**, owner-scoped, with **zero PII/secret on the wire**, such that the badge appears on arrival and **auto-clears** when the patient leaves (heartbeats stop).
- Seed the psychologist UI so an already-present patient shows the badge on first render.
- Clear the badge **immediately on admit** without depending on a static `room.status` prop.
- Replace the static-`pending` / `participantCount` heuristic with heartbeat freshness and fix the stale comment.
- Make wait time measurable (distinct `patient_arrived` audit event).

**Non-Goals:**

- Patient presence in Stream before admission (explicitly preserved as withheld).
- Stream backstage / `watch` / presence, and Supabase Realtime **Presence** (evaluated and rejected — Stream presence reopens the no-JWT-before-admit control and adds billable participant-minutes; Realtime Presence requires the patient to hold a Supabase JWT and join the private channel, which the anonymous token-only patient does not have. The heartbeat reuses the existing poll and needs no patient identity).
- Making *correctness* depend on any single `navigator.sendBeacon` departure beacon arriving. The beacon is now **mandatory to implement** (Decision 6) for fast clearing, but a lost beacon (crash/network) must still leave the system correct — the staleness TTL is the guaranteed fallback.
- Changing the admit flow itself (`admit-patient.ts` already logs `patient_joined`); the post-admit badge clear is a client-state concern.

## Decisions

### Decision 1 — Realtime mechanism: **Broadcast from Database on a PRIVATE channel** (not Postgres Changes)

The psychologist subscribes to a private topic `video-room:<roomId>`. A SECURITY DEFINER trigger on `video_rooms` fires when `patient_last_seen_at` changes (`NEW.patient_last_seen_at IS DISTINCT FROM OLD.patient_last_seen_at`) and emits a **minimal, hand-built** heartbeat payload (`{ room_id, last_seen_at }`) via Supabase's database broadcast primitive. Crucially, `IS DISTINCT FROM` treats NULL as a value, so a **departure** (a timestamp → NULL clear, see Decision 6) also fires the trigger and broadcasts `{ room_id, last_seen_at: null }`; the presence hook reads a null `last_seen_at` as **immediate absence** (no need for a second event type). Authorization is enforced by an RLS policy on `realtime.messages`; the client opens the channel with `{ config: { private: true } }` (the browser Supabase client carries the session JWT, so `auth.uid()` is available to the policy).

**Broadcast volume is within limits.** The patient polls every 10s, so the heartbeat broadcasts at ~0.1 msg/s per channel. Supabase's documented Broadcast limit is **10 messages/second per channel** (and 256 KB/message), so a per-poll trigger broadcast is safe with three orders of magnitude of headroom; no client-side throttle or debounce is required. (`realtime.max_events_per_second` is separately configurable but irrelevant at this volume.)

**Why not Postgres Changes (the `notifications` pattern)?** Postgres Changes has **no column projection** — it streams the entire changed row, subject to row-level (not column-level) RLS. `video_rooms` contains `patient_jwt`, `patient_token`, `partner_jwt`, `partner_token`. Streaming those to the psychologist's browser would leak the **patient's Stream credential** to another party's client (an impersonation vector and an LGPD data-minimization violation), even though the psychologist owns the row. This is the disqualifier. (Postgres Changes also requires `REPLICA IDENTITY FULL` + the `supabase_realtime` publication; per the Supabase reference, with RLS + `REPLICA IDENTITY FULL` only the primary key is sent for DELETEs — not relevant here, but it underscores that Postgres Changes is row-shaped, not field-selectable.)

**Why not server-sent Broadcast from the route (the `ai-transcription` pattern)?** That pattern uses a **public** channel (`user:<uuid>`) relying on UUID unguessability; the prompt requires the subscription to be owner-scoped and to not leak to unauthorized parties. A public channel where any client guessing the psychologist's UUID could learn "a session has an arrival" + the internal `room_id` is a weaker model. Broadcast from Database lets us use a **private** channel authorized by RLS on `realtime.messages`, which is the robust owner-scoping the security mandate requires. It is also **atomic** with the arrival UPDATE (same transaction via the trigger) — no "stamped DB but failed to notify" gap, and no extra service-role usage inside the public route.

**Payload shape — do NOT use `realtime.broadcast_changes`.** Supabase's convenience helper `realtime.broadcast_changes(topic, event, op, table, schema, NEW, OLD)` dumps the full NEW/OLD records — reintroducing the secret-exposure problem. Instead the trigger calls the lower-level `realtime.send(payload jsonb, event text, topic text, private boolean)` with a hand-built JSONB carrying only `room_id` and `last_seen_at`. No tokens, no JWTs, no session/patient IDs.

**Doc basis (Context7 → Supabase official docs):**

- *Realtime Authorization* (`/docs/guides/realtime/authorization`): RLS policies are applied to the `realtime.messages` table; the client must instantiate the channel with `config: { private: true }`. (Confirmed via Context7 `/llmstxt/supabase_llms-full_txt`.)
- *Broadcast from Database* (`/docs/guides/realtime/getting_started`, `/blog/realtime-broadcast-from-database`): a SECURITY DEFINER trigger function calls `realtime.broadcast_changes(...)`; the lower-level `realtime.send(...)` primitive gives exact payload control. RLS on `realtime.messages` governs who may receive.
- *Broadcast → Limits* (`/docs/guides/realtime/broadcast`): "Broadcast messages have a rate limit of 10 messages per second per channel" and 256 KB/message — basis for the per-poll heartbeat being safe (0.1 msg/s).
- *Postgres Changes* (`on(...)` reference): "listening to database changes is disabled by default … manage Realtime replication … `REPLICA IDENTITY FULL` … RLS is not applied to delete statements; when RLS is enabled and replica identity is set to full, only the primary key is sent to clients." — basis for rejecting it here (full-row, no field projection).
- *Realtime Presence*: rejected because Presence tracks state per connected client identity on the (private) channel; the anonymous, token-only patient never joins a Supabase Realtime channel and has no JWT, so there is no client to "be present". The server-side heartbeat is the right primitive for an unauthenticated participant.

### Decision 2 — Data model: two timestamps (`patient_waiting_at` + `patient_last_seen_at`) + `patient_arrived` log event

Two columns with deliberately different mutability, because "first arrived" (audit) and "still here?" (liveness) are different facts:

- `patient_waiting_at timestamptz NULL` — **immutable first-arrival marker**, set **once** on the first waiting poll. Drives the `patient_arrived` audit and wait-time measurement. Never updated again.
- `patient_last_seen_at timestamptz NULL` — **mutable liveness heartbeat**, updated on **every** waiting poll. This is the column the broadcast trigger watches and the one that drives the psychologist's presence badge. Server-rendered into the page to seed the initial freshness check.
- Add `patient_arrived` to the `video_session_logs` `event_type` CHECK set. This is a **distinct** event from the admission `patient_joined`, so wait time = `patient_joined.created_at − patient_arrived.created_at` becomes measurable.

**Why two columns and not one?** A single set-once column cannot represent departure (the latch bug). A single mutable column would lose the immutable first-arrival fact needed for wait-time (every poll would overwrite it). Splitting them keeps audit history exact while giving liveness a cheap, always-current field. The `patient_arrived` log remains the append-only audit; `patient_last_seen_at` is current-state liveness. Not speculative duplication — three distinct jobs (immutable arrival, mutable liveness, append-only audit).

Neither column needs a new index: both are read by id (PK) on render and watched in-row by the trigger; neither is an RLS predicate or a query filter. Only `room_id` + `last_seen_at` are sent over the wire (never a row dump).

### Decision 3 — Heartbeat + set-once arrival in `/api/video/join`

On the `waiting` branch, run a single UPDATE that always refreshes liveness and conditionally stamps first-arrival, using server `now()` for a single consistent clock (avoids client clock skew):

```
UPDATE video_rooms
SET patient_last_seen_at = now(),
    patient_waiting_at = COALESCE(patient_waiting_at, now())
WHERE (patient_token = :token OR partner_token = :token)
RETURNING id, user_id, session_id,
          (patient_waiting_at = patient_last_seen_at) AS is_first_arrival
```

- Every waiting poll: `patient_last_seen_at` advances → trigger fires → heartbeat broadcast (`{ room_id, last_seen_at }`).
- First waiting poll: `patient_waiting_at` is set via `COALESCE` (was NULL); detect "first arrival" from the returned flag (or a separate guarded check) and insert exactly one `patient_arrived` log with the role from the matched token. Subsequent polls leave `patient_waiting_at` unchanged (`COALESCE` keeps the existing value) and insert no further logs — the one-time-log idempotency is enforced by the first-arrival detection, not app-level bookkeeping.
- Uses the existing Drizzle owner client `db` (bypasses RLS) exactly as the rest of the route already does — justified: the patient has no Supabase session and the token is the credential. The route continues to return only `{ status, psychologistName, psychologistPhotoUrl }` — no internal IDs, no JWT, no timestamps echoed back.

(Implementation note: if expressing "first arrival" cleanly in one statement is awkward in Drizzle, an equivalent is a conditional pre-check inside the same transaction — `SELECT patient_waiting_at … FOR UPDATE`, then the UPDATE, then the conditional log insert. Behavior, not SQL shape, is what the spec requires.)

### Decision 4 — Presence-driven psychologist badge (heartbeat freshness + TTL)

The badge is driven by **heartbeat freshness**, not a boolean latch:

- Define a named constant `WAITING_PRESENCE_TTL_MS = 30_000` (30s). The patient polls every 10s, so 30s tolerates ~2 consecutive missed heartbeats before declaring the patient gone — long enough to ride out a transient network blip, short enough that a real departure clears within one TTL.
- The video page server-renders `room` **including** `patient_last_seen_at`, so a patient already present when the page opens shows the badge immediately (no race with a broadcast that already fired).
- A new client hook (e.g. `useVideoRoomPresence`) under `src/modules/telepsicologia/` subscribes to the **private** `video-room:<roomId>` channel (`{ config: { private: true } }`). On each heartbeat broadcast it records `lastSeenAt` and resets a freshness timer; a small interval (e.g. every few seconds) re-evaluates `isPatientPresent = lastSeenAt != null && (Date.now() − lastSeenAt) < WAITING_PRESENCE_TTL_MS`, so when broadcasts stop the badge auto-clears after the TTL. **A broadcast whose `last_seen_at` is null sets `lastSeenAt = null` → `isPatientPresent` becomes false immediately** (the departure fast-path; see Decision 6). Seeds `lastSeenAt` from the server-rendered value. Tears down channel + timers on unmount. Treats the payload as untrusted transport (records a timestamp / flips local state only; never an authz decision). `roomId`/`userId` come from server-rendered props, never client input.
- Badge condition becomes `room.status === 'pending' && isPatientPresent`; the `participantCount` term is removed. The stale "participants beyond the psychologist … in the lobby" comment is corrected to describe the heartbeat/TTL logic.

### Decision 4b — Immediate post-admit clear

`room.status` is a static server-rendered prop the admit flow does not refresh, so relying on it alone leaves the badge visible after `Admitir`. Fix:

- On `onAdmitPatient` success, flip local state so the view treats the room as no longer `pending` (e.g. a local `admitted` boolean OR'd into the gate), making the badge disappear instantly.
- The heartbeat is the backstop: once admitted, the patient's poll resolves to the `active` branch (gets the JWT) and stops being a `waiting` poll, so `patient_last_seen_at` stops advancing and presence would lapse after the TTL anyway. The local clear just makes it instant.
- **Preserved behavior:** "admit, then patient returns within expiry" still works — `status='active'` is durable in the DB, so the returning patient's poll hits the `active` branch and receives the JWT. This change touches only the psychologist's client-side badge gating, not the durable status.

### Decision 5 — Realtime authorization policy on `realtime.messages`

This change introduces the **first private Realtime channel** in the repo. The RLS policy on `realtime.messages` (SELECT, i.e. receive) authorizes a subscriber on topic `video-room:<roomId>` only when that room is owned by the caller:

```
CREATE POLICY "owner can receive video-room presence broadcasts"
  ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND EXISTS (
      SELECT 1 FROM public.video_rooms vr
      WHERE vr.user_id = auth.uid()
        AND realtime.topic() = 'video-room:' || vr.id::text
    )
  );
```

(Exact predicate/column names to be confirmed against the installed Supabase Realtime version during implementation — `realtime.topic()` is the documented helper for the current topic.) The policy lives in `src/shared/db/schema/telepsicologia/policies.ts` and is appended to the migration manually, per the migrations README. Because the topic embeds only the opaque `room_id` (a UUID the owner already knows) and the payload carries no secret, even a hypothetical authorization bypass would expose no PII/JWT.

### Decision 6 — Mandatory departure signal: `sendBeacon` on `pagehide` → `POST /api/video/depart`

The TTL alone gives a ≤30s clearing delay when a patient leaves. To clear the badge **at once**, the patient waiting-room view proactively signals departure; this is now in-scope/mandatory (with the TTL as the backstop).

**Client trigger — `pagehide`, not `beforeunload`.** `waiting-room-view.tsx` registers a `pagehide` listener and calls `navigator.sendBeacon('/api/video/depart', body)` once when the page is being hidden/unloaded. `pagehide` is the current best-practice signal: `beforeunload`/`unload` are unreliable on mobile and break the back/forward cache (bfcache), whereas `pagehide` fires in those cases. (Belt-and-suspenders: a `visibilitychange`→`hidden` handler MAY also fire the beacon; the server endpoint is idempotent so duplicate beacons are harmless.) `sendBeacon` is fire-and-forget and ignores the response — exactly right for an unload-time signal.

**Server touchpoint — a DEDICATED route, not an extension of `/api/video/join`.** A new `POST /api/video/depart` (`src/app/api/video/depart/route.ts`) is chosen over adding a "departing" flag to the join handler because:
- **Single responsibility / no entanglement with JWT issuance.** The join handler's central security property is "Stream JWT only when `active`"; threading a departure branch through its status ladder risks regressions in that critical path. A separate, tiny handler keeps the JWT logic untouched.
- **Independent rate-limit + test surface.** It gets its own per-IP limiter and its own integration test, cleanly.
- It mirrors the join handler's security shape exactly (Node runtime, `force-dynamic`, Zod-validated body, `no-store`).

**Credential — the token in the body.** `sendBeacon` cannot set custom auth headers, so the 64-char hex token remains the sole credential, carried in the beacon body (same `joinBodySchema` shape: `{ token }`, length 64, `^[a-f0-9]+$`). The route is public-but-token-gated, exactly like `/api/video/join`. It is rate-limited per IP (same `createRateLimiter` util) BEFORE any DB work.

**Effect — clear liveness, preserve audit.** On a valid token whose room is still `status IN ('pending')` and within the window (i.e. a `waiting`-equivalent state), the handler runs, via the existing owner Drizzle client (justified identically to join):

```
UPDATE video_rooms
SET patient_last_seen_at = NULL
WHERE (patient_token = :token OR partner_token = :token)
  AND status = 'pending'
  AND patient_last_seen_at IS NOT NULL
```

- This NULL transition fires the heartbeat trigger (Decision 1), broadcasting `{ room_id, last_seen_at: null }` → the psychologist hook clears the badge immediately.
- `patient_waiting_at` is **NOT** touched — the immutable first-arrival audit marker and wait-time basis survive a departure. (A `patient_left` log entry MAY be appended for symmetry with `patient_arrived`; optional, decided in tasks — not required for correctness.)
- The `AND patient_last_seen_at IS NOT NULL` guard makes repeated/duplicate beacons idempotent (second beacon updates zero rows, fires no redundant broadcast). The `AND status = 'pending'` guard ensures a beacon that races an admission (room already `active`) does NOT clear liveness or disturb the active call.

**Idempotency / re-arrival ordering.** Clearing to NULL (rather than a tombstone) means a patient who departs and then **reopens** the link re-establishes presence with zero special-casing: the next `/api/video/join` waiting poll re-stamps `patient_last_seen_at = now()` (and, since `patient_waiting_at` is still set, does NOT re-log `patient_arrived`), the trigger broadcasts a fresh heartbeat, and the badge reappears. Late-arriving stale beacons are neutralized by the `status='pending'` + `IS NOT NULL` guards.

**Security.** No PII/JWT/token in the response (there is none — `sendBeacon` ignores it; the handler returns an opaque/empty 200 or 204). Token-gated, rate-limited, no internal IDs exposed, errors logged without PII. The owner-scoped private broadcast is unchanged. Worst case if the beacon is forged with a guessed token: an attacker could clear *their own* room's liveness early — harmless (the next legitimate poll re-stamps it), and guessing a 256-bit token is infeasible.

**Correctness does not depend on the beacon.** If the beacon never fires (crash, `sendBeacon` dropped, offline), `patient_last_seen_at` simply stops advancing and the TTL clears the badge within ≤30s. The beacon optimizes latency; the TTL guarantees correctness.

## Risks / Trade-offs

- **[Full-row leak via wrong mechanism]** → Rejected Postgres Changes precisely because it would stream `patient_jwt`/tokens. The chosen broadcast sends only `{ room_id, last_seen_at }`. Verified by a unit assertion on the payload shape and by the trigger definition.
- **[`realtime.messages` RLS regression opens a public channel]** → Owner-scoped policy + private channel (`config.private = true`); an integration test asserts a non-owner cannot receive. Defense in depth: payload is non-sensitive even if the policy were too broad.
- **[Plain-Postgres / Testcontainers lacks `realtime` schema & `supabase_realtime`]** → Guard the trigger/policy creation with `DO $$ … IF EXISTS (… 'realtime' schema / function …) …` blocks, mirroring migration `0039`'s publication guard, so migrations apply cleanly on CI/local non-Supabase Postgres. Integration tests that need the realtime schema must state the dependency explicitly (per CLAUDE.md "state it explicitly instead of silently skipping").
- **[Heartbeat broadcast volume]** → A 10s poll is 0.1 msg/s per channel vs. Supabase's 10 msg/s-per-channel Broadcast limit (cited above) — three orders of magnitude of headroom, one channel per active session. No throttle/debounce needed; no `realtime.broadcast_changes` row dumps.
- **[TTL tuning]** → 30s tolerates ~2 missed 10s heartbeats. Too low → flicker on a transient blip; too high → stale badge lingers after departure. 30s is the balance; the constant is named and centralized so it can be tuned (and shortened/injected in tests). The TTL is the *guaranteed* clearing path even if `sendBeacon` and broadcasts both fail.
- **[Clock skew]** → All timestamps come from server `now()` in the same UPDATE (single clock); the client compares `Date.now()` against the server `last_seen_at` only for the freshness window, where a few seconds of skew is harmless relative to a 30s TTL. We do not compare two different clients' clocks.
- **[Broadcast missed while subscribing]** → Initial presence is seeded from the server-rendered `patient_last_seen_at`, so a missed broadcast cannot hide an already-present patient; the next 10s heartbeat refreshes freshness, and the psychologist can always admit manually. No silent failure.
- **[Trigger fires on unrelated `video_rooms` UPDATEs]** → `WHEN (NEW.patient_last_seen_at IS DISTINCT FROM OLD.patient_last_seen_at)` restricts it to heartbeat changes only; admit/end/expire updates that do not touch `patient_last_seen_at` do not broadcast.
- **[Stamping before the availability window]** → The heartbeat/stamp happens only on the `waiting` branch, already gated by `now() >= available_from` and `status === 'pending'`; `too_early`/`ended`/`expired`/`active` branches never write either timestamp.
- **[`sendBeacon` unreliability]** → The departure beacon is mandatory to implement but best-effort to deliver (browsers do not guarantee delivery; offline/crash drops it). Correctness never depends on a single beacon — the TTL clears the badge regardless. `pagehide` (over `beforeunload`/`unload`) maximizes delivery on mobile + bfcache.
- **[Departure races an admission]** → The `depart` UPDATE is guarded by `status = 'pending'`, so a beacon arriving after the psychologist admitted (room `active`) updates zero rows and cannot disturb the live call or clear liveness for an active session.
- **[Forged departure beacon]** → Token-gated + rate-limited; a forged beacon could at most clear the attacker's own (token-owned) room's liveness, which the next legitimate poll re-stamps. Guessing the 256-bit token is infeasible. No cross-room/cross-tenant effect.
- **[Duplicate beacons]** → `pagehide` + optional `visibilitychange` could fire twice; the `patient_last_seen_at IS NOT NULL` guard makes the second a no-op (zero rows, no redundant broadcast).

## Migration Plan

1. Add `patient_waiting_at` and `patient_last_seen_at` to `video_rooms` in `tables.ts`; add `patient_arrived` to the `video_session_logs` CHECK.
2. `npm run db:generate`; manually append to the generated migration: the CHECK-constraint swap, the SECURITY DEFINER heartbeat trigger function + trigger (guarded for non-Supabase Postgres), and the `realtime.messages` RLS policy (also guarded).
3. Author `policies.ts` entry for the `realtime.messages` policy so the policy-coverage contract sees it.
4. `npm run db:migrate`.
5. Ship route + UI + hook changes: `/api/video/join` heartbeat, the new `/api/video/depart` route, the presence hook (incl. null-heartbeat fast-path), the TTL constant, the post-admit clear, and the mandatory `sendBeacon`-on-`pagehide` wiring in `waiting-room-view.tsx`.

**Rollback:** the two columns and the CHECK addition are additive/reversible; dropping the trigger, function, and `realtime.messages` policy restores prior behavior (the badge reverts to the static heuristic only if the UI change is also reverted). No user data is destroyed. The presence feature degrades gracefully if Realtime is unavailable — the server-seeded `patient_last_seen_at` freshness check still works on render, and the psychologist can admit manually.

## Open Questions

- Confirm the exact `realtime.messages` policy predicate (`realtime.topic()` vs. `realtime.messages.topic`) and the `realtime.send` signature against the Supabase Realtime version pinned in the project's local stack during implementation.
- Confirm the cleanest single-statement form for "advance heartbeat + set-once arrival + detect first arrival" in Drizzle vs. the transactional pre-check fallback noted in Decision 3 (behavioral equivalence is the requirement).

(Resolved, formerly open: "patient left before admit" is now handled by the heartbeat + TTL model and is in scope.)
