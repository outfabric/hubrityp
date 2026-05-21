## 1. Dependencies and env vars

- [x] 1.1 Install Stream SDKs: `npm install @stream-io/node-sdk @stream-io/video-react-sdk`
- [x] 1.2 Add env vars to `src/shared/env/schemas.ts` — extend `serverEnvSchema` with `STREAM_API_KEY` (z.string().min(1)) and `STREAM_API_SECRET` (z.string().min(1)). Extend `clientEnvSchema` with `NEXT_PUBLIC_STREAM_API_KEY` (z.string().min(1)). Add all three to `.env.example`
- [x] 1.3 **Unit test:** Create `src/__tests__/unit/shared/env/stream-env-vars.test.ts` — verify `serverEnvSchema` rejects missing `STREAM_API_KEY`/`STREAM_API_SECRET`, verify `clientEnvSchema` rejects missing `NEXT_PUBLIC_STREAM_API_KEY`

## 2. Database schema — video_rooms + video_session_logs + video_recordings

- [x] 2.1 Create `src/shared/db/schema/telepsicologia/tables.ts` — define `video_rooms` table: id (uuid PK), user_id (uuid NOT NULL), session_id (uuid NOT NULL UNIQUE), stream_call_id (varchar 255 NOT NULL), patient_token (varchar 64 NOT NULL), patient_jwt (text NOT NULL), partner_token (varchar 64), partner_jwt (text), available_from (timestamptz NOT NULL), expires_at (timestamptz NOT NULL), recording_enabled (boolean DEFAULT false), recording_consent_signed (boolean DEFAULT false), status (text NOT NULL DEFAULT 'pending', CHECK: pending/active/ended/expired), created_at (timestamptz DEFAULT now()). Indexes: unique on session_id, (user_id, status), (expires_at)
- [x] 2.2 Add `video_session_logs` table in same file: id (uuid PK), session_id (uuid NOT NULL), user_id (uuid NOT NULL), event_type (varchar 30 NOT NULL, CHECK constraint for valid event types), participant_role (varchar 20), metadata (jsonb), created_at (timestamptz DEFAULT now()). Index: (session_id, created_at)
- [x] 2.3 Add `video_recordings` table in same file: id (uuid PK), session_id (uuid NOT NULL), user_id (uuid NOT NULL), stream_recording_id (varchar 255), duration_seconds (integer), status (text NOT NULL DEFAULT 'idle', CHECK: idle/recording/processing/transcribed/discarded), audio_temp_url (text), transcription_id (uuid nullable), recorded_at (timestamptz), discarded_at (timestamptz), created_at (timestamptz DEFAULT now()). Index: (session_id)
- [x] 2.4 Create `src/shared/db/schema/telepsicologia/policies.ts` — RLS policies: video_rooms uses `user_id = auth.uid()` (SELECT/INSERT/UPDATE/DELETE). video_session_logs uses `user_id = auth.uid()` (SELECT/INSERT only — append-only). video_recordings uses `user_id = auth.uid()` (SELECT/INSERT/UPDATE only). Follow pattern from `src/shared/db/schema/patients/policies.ts`
- [x] 2.5 Create `src/shared/db/schema/telepsicologia/index.ts` — barrel re-exporting tables and policies
- [x] 2.6 Update `src/shared/db/schema/index.ts` — add re-export of `./telepsicologia`
- [x] 2.7 Add recording consent columns to `patients` table in `src/shared/db/schema/patients/tables.ts`: `recording_consent_signed_at` (timestamptz nullable), `recording_consent_revoked_at` (timestamptz nullable)
- [x] 2.8 Run `npm run db:generate`, edit migration to include: RLS ENABLE + policies SQL, CHECK constraints, FK constraints to auth.users and sessions (manual, cross-schema), UNIQUE on video_rooms.session_id, all indexes
- [x] 2.9 Test migration with `npm run db:migrate` local
- [x] 2.10 **Integration test:** Create `src/__tests__/integration/telepsicologia/schema.int.test.ts` — verify: all three tables exist, RLS enabled on each, CHECK constraints reject invalid status/event_type, UNIQUE on video_rooms.session_id enforced, FK constraints work, indexes exist, recording_consent columns exist on patients with correct types. RLS cross-user test: user A cannot read user B's video_rooms/logs/recordings

## 3. Zod schemas and branded types

- [x] 3.1 Create `src/modules/telepsicologia/lib/schemas.ts` — Zod schemas: `videoRoomInputSchema` (session_id: z.string().uuid()), `videoTokenInputSchema` (room_id: z.string().uuid()), `videoRoomSchema` (full row shape for type inference). Export types via z.infer
- [x] 3.2 Create `src/modules/telepsicologia/lib/video-url.ts` — pure function `generatePatientVideoUrl(baseUrl: string, token: string): string` that returns `${baseUrl}/v/${token}`. Validate token is 64-char hex
- [x] 3.3 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/lib/schemas.test.ts` — test: valid input accepted, invalid UUID rejected, missing fields rejected
- [x] 3.4 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/lib/video-url.test.ts` — test: correct URL format, invalid token (non-hex, wrong length) rejected, baseUrl with trailing slash handled

## 4. Stream client singleton

- [ ] 4.1 Create `src/modules/telepsicologia/server/stream-client.ts` — lazy singleton `getStreamClient()` using `StreamClient` from `@stream-io/node-sdk` initialized with `serverEnv.STREAM_API_KEY` and `serverEnv.STREAM_API_SECRET`. Add `import 'server-only'` guard
- [ ] 4.2 **Unit test:** Create `src/__tests__/unit/modules/telepsicologia/server/stream-client.test.ts` — mock `@stream-io/node-sdk` and `@/shared/env`, verify: singleton returns same instance on repeated calls, passes correct key/secret from env

## 5. Server Actions — createVideoRoom + getVideoToken

- [ ] 5.1 Create `src/modules/telepsicologia/server/create-video-room.ts` — Server Action: (1) authenticate via supabase.auth.getUser(), (2) validate input with videoRoomInputSchema, (3) verify session ownership (WHERE id = input.session_id AND user_id = auth.uid()), (4) verify session modality is 'online' and status is 'scheduled' or 'confirmed', (5) check no existing video_rooms row for this session, (6) generate 64-char hex patient_token via crypto.randomBytes(32), (7) compute available_from (session.start_at - 10min) and expires_at (session.end_at + 1h), (8) create Stream call via getStreamClient().video.call('default', roomId).getOrCreate() with settings: max_participants=2 (or 3 for couple), screensharing enabled, recording mode='available', (9) mint patient JWT via client.generateCallToken({ user_id: 'patient-<patientId>', call_cids: ['default:<roomId>'], validity_in_seconds }), (10) INSERT video_rooms row, (11) return { ok: true, room }. Sanitize errors — never expose Stream/Postgres messages
- [ ] 5.2 Create `src/modules/telepsicologia/server/get-video-token.ts` — Server Action: (1) authenticate via supabase.auth.getUser(), (2) validate input with videoTokenInputSchema, (3) verify room ownership (WHERE id = input.room_id AND user_id = auth.uid()), (4) verify room status is 'pending' or 'active', (5) mint psychologist JWT via client.generateCallToken({ user_id: auth.uid(), call_cids: ['default:<streamCallId>'], role: 'admin', validity_in_seconds: 7200 }), (6) return { ok: true, token }
- [ ] 5.3 **Integration test:** Create `src/__tests__/integration/telepsicologia/create-video-room.int.test.ts` — mock Stream SDK (getOrCreate, generateCallToken). Tests: happy path creates room + DB row, session not owned by user -> rejected, session not online -> rejected, session already has room -> rejected, session cancelled -> rejected. Verify RLS: user B cannot see user A's room
- [ ] 5.4 **Integration test:** Create `src/__tests__/integration/telepsicologia/get-video-token.int.test.ts` — mock Stream SDK. Tests: happy path returns token, room not owned -> rejected, room expired -> rejected, unauthenticated -> rejected

## 6. Module barrel and edge entrypoint

- [ ] 6.1 Create `src/modules/telepsicologia/index.ts` — barrel re-exporting: Server Actions (createVideoRoom, getVideoToken), lib (videoRoomInputSchema, videoTokenInputSchema, generatePatientVideoUrl), types
- [ ] 6.2 Create `src/modules/telepsicologia/edge.ts` — edge-safe entrypoint exporting only types and pure functions that do NOT import Node-only deps (no Drizzle, no Stream SDK). This is for future middleware consumption when video routes are classified
