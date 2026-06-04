## Context

The telepsychology video call feature uses Stream.io Video SDK. The server-side code (Node SDK) creates Stream calls and generates call-scoped JWTs correctly, but never calls `streamClient.upsertUsers()` to register users in Stream's user database. This is a required step per Stream's API contract: a user must exist before the client-side SDK can authenticate them and allow `call.join()`.

The relevant existing code:
- `src/modules/telepsicologia/server/create-video-room-helper.ts` — shared helper for room creation (Server Action + Inngest auto-create)
- `src/modules/telepsicologia/server/get-video-token.ts` — mints psychologist JWT on page load
- `src/app/api/video/join/route.ts` — public endpoint that returns patient JWT
- `src/modules/telepsicologia/components/pre-call-lobby.tsx` — psychologist lobby, `call.join()` here
- `src/modules/telepsicologia/components/patient-in-call-view.tsx` — patient calls `call.join()` here

Stream user IDs in use:
- Psychologist: Supabase UUID directly (e.g. `a1b2c3d4-...`)
- Patient: `patient-<patientId>` (synthetic, established in `create-video-room-helper.ts:145`)
- Partner (couple sessions): would use `partner-<patientId>` pattern if partner tokens exist

## Goals / Non-Goals

**Goals:**
- Fix the broken video call flow by registering users in Stream before they join calls
- Ensure both psychologist and patient flows work end-to-end
- Add observability: log actual Stream errors client-side instead of swallowing them
- Maintain idempotency — repeated `upsertUsers` calls are safe

**Non-Goals:**
- Changing the token type (`generateCallToken` → `generateUserToken`) — call tokens are correct for scoped access
- Adding `members` array to `getOrCreate` — open call + call-scoped token is the intended design
- Refactoring the telepsicologia module architecture
- Adding Stream user lifecycle management (deactivation, deletion)
- Changing the synthetic patient user ID convention

## Decisions

### D1: Upsert users in the room creation helper (primary) + token minting (secondary)

**Decision**: Call `streamClient.upsertUsers()` in `create-video-room-helper.ts` (primary) and again in `get-video-token.ts` (secondary, idempotent refresh).

**Rationale**: The helper is the canonical entry point for room creation, used by both the interactive Server Action and the Inngest auto-create function. Upsert here covers all creation paths. The secondary upsert in `get-video-token.ts` ensures the psychologist's name is current when they actually open the page (the Inngest job may have run hours earlier with stale data).

**Alternative considered**: Upsert only in the helper. Rejected because the psychologist's profile name could change between room creation and session start. The idempotent upsert in token minting keeps Stream in sync cheaply.

### D2: Upsert patient user in the join Route Handler, not in the room creation helper

**Decision**: Call `upsertUsers()` for the patient in the `/api/video/join` Route Handler (`status === 'active'` branch), in addition to the room creation helper.

**Rationale**: The room creation helper already has the patient data available, so it should upsert the patient during creation. However, the join Route Handler adds a secondary upsert to handle edge cases (patient name updated after room creation). The join handler is the last server-side touchpoint before the patient enters the call.

### D3: Pass user name to Stream for display in call UI

**Decision**: Include `name` in the `upsertUsers` payload (psychologist: `profiles.fullName`, patient: `patients.fullName`).

**Rationale**: Stream uses the `name` field for participant display in the call UI. Without it, participants appear as raw UUIDs. The name is already available in the data-fetching context of both the helper and the join route.

### D4: Log actual errors in client-side catch blocks

**Decision**: Add `console.error('[telepsicologia]', err)` in the `call.join()` catch blocks in `pre-call-lobby.tsx` and `patient-in-call-view.tsx`.

**Rationale**: The current catch blocks discard the error, making debugging impossible. Client-side `console.error` is visible in browser DevTools and Vercel's client-side error tracking (if configured). No PII is logged — the error comes from Stream's SDK and contains only call/connection metadata.

### D5: The `create-video-room-helper` function signature expands to accept user display names

**Decision**: Add psychologist name and patient name as fields in the `SessionData` interface passed to `createVideoRoomHelper`.

**Rationale**: The helper needs names for the `upsertUsers` call. The callers (Server Action `createVideoRoomImpl` and Inngest `auto-create-room`) already have access to this data from their own DB queries. Expanding `SessionData` is the cleanest approach — it keeps the helper pure (no DB queries of its own beyond the idempotent check and patient type lookup it already does).

**Alternative considered**: Have the helper query `profiles.fullName` and `patients.fullName` internally. Rejected because it would add DB queries to a function that the callers already have in-context, and would couple the helper to schema imports it currently doesn't need.

## Risks / Trade-offs

- **[Additional Stream API latency]** → Each `upsertUsers` call adds ~50-100ms. Mitigated: happens once during room creation (not user-facing critical path) and is idempotent on subsequent calls. The token minting upsert runs when the psychologist opens the video page, well before they click "join".

- **[Stream rate limits on upsertUsers]** → Extremely unlikely for this use case (one psychologist + one patient per session). Stream's rate limits are generous for upsert operations.

- **[Name sync drift]** → If a psychologist or patient changes their name after the last upsert but before the call, Stream shows the stale name. Mitigated: the secondary upsert in `get-video-token.ts` (psychologist) and `/api/video/join` (patient) refresh the name at call-join time.
