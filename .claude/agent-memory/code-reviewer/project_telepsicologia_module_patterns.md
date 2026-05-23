---
name: telepsicologia-module-patterns
description: Architecture patterns, security decisions, and recurring issues for the telepsicologia (Stream.io video) module — changes 1 (data model) and 2 (psychologist call UI)
metadata:
  type: project
---

## Module structure (change 1: 2026-05-21, change 2: 2026-05-22)

- `src/modules/telepsicologia/` — domain module with `lib/schemas.ts`, `lib/video-url.ts`, `server/stream-client.ts`, `server/create-video-room.ts`, `server/get-video-token.ts`, `server/admit-patient.ts`, `server/end-video-session.ts`, `index.ts` barrel, `edge.ts` edge-safe entrypoint.
- `src/app/(app)/sessao/[id]/video/` — page.tsx (Server Component), layout.tsx (minimal chrome), actions.ts ('use server' shell), create-room-card.tsx ('use client').
- `src/modules/telepsicologia/components/` — VideoCallLoader (ssr:false wrapper), VideoCallClient, PreCallLobby, InCallView, CallControlBar, PostCallView, EndCallDialog, ConnectionQualityIndicator, ElapsedTime.
- `src/shared/db/schema/telepsicologia/` — tables, policies, index barrel.
- Three tables: `video_rooms` (full CRUD RLS), `video_session_logs` (append-only: SELECT+INSERT only), `video_recordings` (SELECT+INSERT+UPDATE, no DELETE).

## Resolved issues from change 1

- VideoRoom type collision: FIXED. `index.ts` now exports `VideoRoom` from Drizzle `$inferSelect` only. No Zod `VideoRoom` type.
- RLS user_id indexes: FIXED. `video_session_logs_user_id_idx` and `video_recordings_user_id_idx` now present in `tables.ts`.
- VideoRoom type collision confirmed resolved in review-2.

## Security patterns verified (change 2)

- All four Server Action impls (`createVideoRoomImpl`, `getVideoTokenImpl`, `admitPatientImpl`, `endVideoSessionImpl`) call `supabase.auth.getUser()` FIRST before any DB/Stream work.
- IDOR prevention: double predicate `eq(table.userId, userId)` in every Drizzle query + RLS policy as second layer.
- Stream JWT is call-scoped (`call_cids: ['default:<streamCallId>']`), 2-hour validity, minted server-side only.
- `STREAM_API_SECRET` stays server-only. `NEXT_PUBLIC_STREAM_API_KEY` is intentionally public.
- Error responses sanitized: PG error codes in server logs, user-facing strings only on client.
- No PII in logs: only `event` name and `errorCode` (PG code). No patient names, emails, UUIDs of clinical data.

## Known open issues (change 2 review findings)

### Missing DB transactions (HIGH — not yet fixed)
`admitPatientImpl` and `endVideoSessionImpl` do multiple sequential writes without `db.transaction()`:
- `admitPatientImpl`: UPDATE video_rooms + INSERT video_session_logs
- `endVideoSessionImpl`: UPDATE video_rooms + UPDATE sessions + INSERT video_session_logs
If any write after the first fails, partial state results (room ended but session still 'scheduled', or audit log missing). The Stream call `.end()` is correctly outside — it's a remote call and can't be rolled back. Fix: wrap the DB writes in `db.transaction()`, Stream call before the transaction.

### Missing E2E negative-auth test for /sessao (HIGH — not yet fixed)
`app-routes-auth-gate.spec.ts` has no case for `/sessao/*`. Integration test (`sessao-route-gating.int.test.ts`) covers the middleware logic thoroughly, but the project requires both integration AND E2E coverage for auth gates. A simple `page.goto('/sessao/fake-uuid/video') -> waitForURL('/login')` test is needed.

### onAdmitPatient prop unused in CallControlBar (MEDIUM)
The `admitPatient` Server Action is fully implemented and tested, but the UI never calls it. `CallControlBar` accepts `onAdmitPatient` in its props interface but does not destructure or invoke it. The waiting-room badge in `InCallView` is informational only. Feature is incomplete — either wire an "Admitir paciente" button or remove the prop.

### Still-open from change 1: createVideoRoom concurrent race (transaction)
Concurrent `createVideoRoom` calls for the same session both pass the idempotency read, then one hits `23505` unique constraint. The catch block returns `unknown` error instead of re-fetching the existing room.

## Stream.io client component pattern

- `VideoCallLoader` in a `'use client'` file uses `next/dynamic` with `ssr: false` — keeps Stream SDK out of SSR and other pages' initial chunk.
- Stream CSS imported inside the dynamically-loaded component only, preventing global style leakage.
- `StreamVideoClient` initialized in `useEffect`, disconnected on unmount.
- Token and apiKey passed as RSC props: necessary by design (Stream SDK requires them client-side). Token is scoped to the specific call.

## Test patterns (change 2)

- Integration: `fakeSupabaseClient(userId)` returns mock `auth.getUser()`. `runAsService` seeds fixtures. `runAsUser(userId, fn)` verifies RLS cross-user isolation.
- Unit: Stream SDK mocked via `vi.mock('@stream-io/video-react-sdk', ...)` returning mock hooks/call objects.
- Negative-auth integration test for middleware: `sessao-route-gating.int.test.ts` with `vi.mock('@/modules/registration/edge')` and `vi.mock('@/shared/supabase/middleware')`.

**Why:** Telepsicologia PRD 09 — Stream.io video calling, psychologist call UI.
**How to apply:** When reviewing change 3+ (patient join flow, chat, recording), verify transactions are added, E2E auth gate test is present, and onAdmitPatient is wired to actual UI.
