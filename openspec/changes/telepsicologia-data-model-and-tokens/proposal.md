## Why

PRD 09 adds integrated video calling for online psychotherapy sessions via Stream.io. Before any UI can be built, the platform needs: (a) database tables to track video rooms, session logs, and recordings, (b) a server-side Stream client for creating calls and minting scoped JWTs, and (c) env var plumbing for the Stream API key/secret. This change establishes the foundational data model and server-side token infrastructure that all subsequent telepsicologia changes depend on.

## What Changes

- New `src/modules/telepsicologia/` module with barrel, `lib/`, `server/`, and `edge.ts` (the middleware needs to classify new video routes)
- New Drizzle tables in `src/shared/db/schema/telepsicologia/`: `video_rooms` (1:1 with sessions, stores Stream call ID, patient token, availability window, recording flags), `video_session_logs` (append-only event log: join/leave/screen-share/connection-drop), `video_recordings` (ephemeral audio recording lifecycle for PRD 10 integration)
- RLS policies per table: owner-scoped via `user_id = auth.uid()` (video_rooms, video_session_logs, video_recordings)
- New columns on `patients`: `recording_consent_signed_at` and `recording_consent_revoked_at` for Res. CFP 13/2022 consent tracking
- Stream.io Node.js SDK (`@stream-io/node-sdk`) as new dependency
- Server-side Stream client singleton in `src/modules/telepsicologia/server/stream-client.ts` using `serverEnv` credentials
- Server Action `createVideoRoom` — creates a Stream call via `client.video.call('default', roomId).getOrCreate()`, persists the `video_rooms` row, generates patient token via `client.generateCallToken()` scoped to the call
- Server Action `getVideoToken` — mints a call-scoped JWT for the authenticated psychologist
- Pure helper `generatePatientVideoUrl` — builds the public patient join URL from a token
- Zod schemas for all new table shapes and action inputs
- Env vars: `STREAM_API_KEY`, `STREAM_API_SECRET` added to `serverEnvSchema`; `NEXT_PUBLIC_STREAM_API_KEY` added to `clientEnvSchema` (the React SDK needs the public key)

## Capabilities

### New Capabilities

- `telepsicologia-data-model`: Drizzle schema for `video_rooms`, `video_session_logs`, `video_recordings` with RLS policies, indexes, and migration. Recording consent columns on `patients`
- `telepsicologia-token-minting`: Server-side Stream client, call creation, call-scoped JWT generation for psychologist and patient, patient video URL generation

### Modified Capabilities

- `patient-crud`: Adds `recording_consent_signed_at` and `recording_consent_revoked_at` columns to `patients` table for Res. CFP 13/2022 compliance

## Impact

- **Dependencies:** `@stream-io/node-sdk` (new), `@stream-io/video-react-sdk` (new — installed here for the `NEXT_PUBLIC_STREAM_API_KEY` to be useful, but UI usage is in subsequent changes)
- **DB schema:** New folder `src/shared/db/schema/telepsicologia/` (tables.ts, policies.ts, index.ts); ALTER TABLE patients adds 2 columns
- **Module:** New `src/modules/telepsicologia/` with server actions and pure helpers
- **Env:** 3 new env vars (2 server, 1 client-public)
- **Security:** Stream API secret stored in `serverEnv` only; patient tokens are call-scoped with expiry; RLS on all new tables
