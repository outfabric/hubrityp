## Context

After a psychologist schedules an online session, the patient's video room link (`/v/[token]`) cannot be viewed or copied because the token is generated ~1 hour before the session by the deferred Inngest auto-creation flow. The psychologist needs to share the link with the patient immediately after scheduling, typically via WhatsApp or email.

Current room creation pipeline:

```
createSessionImpl
  └─▶ INSERT sessions row
  └─▶ emit agenda/session.created (Inngest)
         └─▶ autoCreateVideoRoom
               └─▶ step.sleepUntil(startAt − 1h)
               └─▶ createVideoRoomHelper
                     ├─ randomBytes(32) → patient_token
                     ├─ Stream call.getOrCreate()
                     ├─ generateCallToken() → patient_jwt
                     └─ INSERT video_rooms
```

The `/v/[token]` route, the `PatientVideoPage` component, and the `/api/video/join` Route Handler already exist and handle time-gating (`TooEarlyView`), waiting room, and active call states.

Key constraint: `APP_URL` is optional in `serverEnvSchema` — features that need it must degrade gracefully when absent.

## Goals / Non-Goals

**Goals:**

- Make the patient video URL available from the moment an online session is created
- Display a "copy patient link" section in the Session Detail Drawer for online sessions
- Show a post-scheduling Sonner toast with a copy action when an online session is created
- Preserve backward compatibility: sessions created before this change, and the Inngest deferred-activation flow, must continue to work
- Handle the `/v/[token]` visit before Stream activation gracefully (reuse existing `TooEarlyView`)

**Non-Goals:**

- Backfilling tokens for existing sessions (confirmed unnecessary — test data only)
- Sending the link automatically to the patient (that is a separate WhatsApp template feature)
- Changing the public patient join UX (no new views, no new routes)
- Making `APP_URL` required — degrade gracefully when absent

## Decisions

### D1. Split room lifecycle into reservation + activation

**Decision:** decouple the `video_rooms` row into two phases:

1. **Reservation** (at schedule time): insert a row with `patient_token`, `available_from`, `expires_at`, and `status='pending'`, but with `stream_call_id=NULL` and `patient_jwt=NULL`.
2. **Activation** (at startAt − 1h via Inngest): UPDATE the existing row with Stream call ID, patient JWT, and any partner fields.

**Why not store the token on the `sessions` table?** The `video_rooms` table already owns `patient_token`, the `/v/[token]` route and `/api/video/join` already query by it, and RLS policies are already in place. Moving the token to `sessions` would split ownership, require a new lookup path, and add unnecessary complexity.

**Schema change:** `video_rooms.stream_call_id` (varchar NOT NULL → nullable) and `video_rooms.patient_jwt` (text NOT NULL → nullable). Migration: `ALTER COLUMN ... DROP NOT NULL`. No data loss. Reversible.

### D2. New `reserveVideoRoom` helper

**Decision:** create a new server function `reserveVideoRoom(session, db)` in `src/modules/telepsicologia/server/reserve-video-room.ts` that:
1. Checks idempotency (session already has a room → return existing room's `patient_token`).
2. Generates `patient_token` via `randomBytes(32)`.
3. Computes `available_from` (startAt − 10min) and `expires_at` (endAt + 1h) using the same constants from `create-video-room-helper.ts` (extract them to a shared `lib/room-constants.ts`).
4. INSERTs a `video_rooms` row with `stream_call_id=NULL`, `patient_jwt=NULL`, `status='pending'`.
5. Returns `{ ok: true, patientToken: string }` or `{ ok: false, message: string }`.

This function is called from `createSessionImpl` (for new online sessions) and from `updateSessionImpl` (when modality changes to online).

**Import:** Uses `'server-only'` and the Drizzle db client directly. No Stream SDK dependency — this is pure DB work.

### D3. Modify `createVideoRoomHelper` to support activation mode

**Decision:** when called, `createVideoRoomHelper` first checks for an existing room (existing idempotent path). If it finds a room with `stream_call_id=NULL` (reserved but not activated), it performs an UPDATE instead of INSERT: creates the Stream call, mints the patient JWT, and updates the row.

This keeps the helper fully backward-compatible — if there is no reserved row (e.g., old sessions), it falls back to the current INSERT path.

### D4. Modify `autoCreateVideoRoom` Inngest handler

**Decision:** the Inngest handler already calls `createVideoRoomHelper`, which now handles both INSERT (no row) and UPDATE (reserved row). The only Inngest-side change is that `findExistingRoom` must distinguish between "room exists and is fully activated" (skip) vs. "room exists but is reserved" (activate). We update the guard to skip only when `stream_call_id IS NOT NULL`.

### D5. `createSessionImpl` returns `patientVideoUrl`

**Decision:** extend `CreateSessionResult` to include `patientVideoUrl?: string`. After inserting the session, if `modality === 'online'`, call `reserveVideoRoom` and, if `APP_URL` is available, build the URL via `generatePatientVideoUrl(appUrl, token)`. If `APP_URL` is absent, omit the field (graceful degradation).

The same applies to `updateSessionImpl` when modality changes to `'online'`.

### D6. `/api/video/join` handles reserved-but-not-activated rooms

**Decision:** when the Route Handler finds a room with `stream_call_id=NULL`, it treats this the same as `too_early` — the patient sees "Sua sessão é às [hora]. Volte 10 minutos antes." This reuses the existing `TooEarlyView` and requires no new client-side state.

The existing status logic in the Route Handler already checks `availableFrom` before checking `status`. We add a check: if `room.streamCallId === null`, return `too_early` with the session start time (resolved from the `sessions` table via `room.sessionId`).

### D7. Session Detail Drawer — copy link section

**Decision:** add a new section in `SessionDetailDrawer` between "Modality" and "Amount", visible when:
- Session is not a blocking slot
- `session.modality === 'online'`
- `session.status` is `'scheduled'` or `'confirmed'`

The section displays:
- Section label: `caption-upper` "Link do paciente" (following the pattern of "Observacoes" and "Historico")
- A truncated URL in `body-sm` / `text-secondary`
- A "Copiar link" Button `variant="secondary"` `size="sm"` with a `Copy` Lucide icon (or `Check` after successful copy), using `navigator.clipboard.writeText()`

**Data source:** the drawer needs the patient video URL. Options:
1. Extend `SessionWithDetails` to include `patientVideoUrl` (requires a JOIN to `video_rooms` in `listSessionsImpl`).
2. Lazy-load the URL when the drawer opens (similar to how history is lazy-loaded).

**Choice: option 1** — extend `SessionWithDetails` with `patientVideoUrl: string | null`. The `listSessionsImpl` query already JOINs `patients` and `locations`; adding a LEFT JOIN to `video_rooms` on `session_id` and selecting `patient_token` is lightweight (indexed by `video_rooms_session_id_unique_idx`). The URL is built server-side using `APP_URL` + `generatePatientVideoUrl()`. If `APP_URL` is absent, the field is `null`.

### D8. Post-scheduling toast with copy action

**Decision:** after `handleSubmit` in `SessionFormModal` succeeds for a new online session, show a Sonner toast with:
- Success icon (default Sonner success variant)
- Title: "Sessão agendada com sucesso."
- Description: "Link do paciente disponível para cópia."
- Action button: "Copiar link" → `navigator.clipboard.writeText(url)` → change button text to "Copiado!" for 2s
- Auto-dismiss: 8s (longer than the default 4s to give time to copy)

The `patientVideoUrl` comes from the `MutationResult` returned by `onCreate`. `MutationResult` needs a new optional `patientVideoUrl?: string` field.

If `patientVideoUrl` is absent (no `APP_URL`, or modality is not online), the standard simple toast is shown (no copy action).

### D9. Shared room time-window constants

**Decision:** extract `ROOM_AVAILABLE_BEFORE_MINUTES` (10) and `ROOM_EXPIRES_AFTER_HOURS` (1) from `create-video-room-helper.ts` into `src/modules/telepsicologia/lib/room-constants.ts`, so both `reserveVideoRoom` and `createVideoRoomHelper` use the same values. This prevents drift.

## Risks / Trade-offs

**[Risk] Orphaned reserved rooms (session cancelled before activation)** → Mitigation: the existing `cancelRoomOnSessionCancel` Inngest function already handles this — it finds the room by `session_id` and sets `status='expired'`. Works identically for reserved rows because it does not check `stream_call_id`.

**[Risk] Race between `reserveVideoRoom` (schedule time) and `autoCreateVideoRoom` (Inngest)** → Mitigation: `reserveVideoRoom` handles the unique constraint on `session_id` — if the Inngest function somehow runs first (e.g., session scheduled <1h ahead), the reservation helper returns the existing room. `createVideoRoomHelper` also handles 23505 (unique violation) and re-fetches.

**[Risk] `APP_URL` missing in local dev / CI** → Mitigation: all URL-building paths check for `APP_URL` before calling `generatePatientVideoUrl`. If absent, `patientVideoUrl` is `null` and the UI simply does not show the copy affordance. No errors, no broken flows.

**[Risk] Token exposed in clipboard / chat history** → Accepted: the token is 256 bits of entropy (equivalent security to the existing `confirmar-sessao/[token]` and `termo/[token]` patterns). The URL is not a secret to the patient — they need it to join. The psychologist shares it intentionally.

**[Trade-off] Extra LEFT JOIN in `listSessionsImpl`** → The join uses the unique index `video_rooms_session_id_unique_idx`, so it is an index lookup (not a scan). The cost is negligible for the typical query window (1 week of sessions).

**[Trade-off] `stream_call_id` and `patient_jwt` become nullable** → This is the correct semantic: a room in the "reserved" state genuinely does not have these values yet. All code that reads these columns must handle null (the `/api/video/join` handler, `getVideoTokenImpl`, Inngest handler). The migration is reversible (`ALTER COLUMN ... SET NOT NULL` after ensuring no NULL rows exist).
