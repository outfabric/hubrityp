## 1. Upsert users in room creation helper + tests

- [x] 1.1 Expand `SessionData` interface in `create-video-room-helper.ts` to accept `psychologistName: string` and `patientFullName: string | null`. Add `streamClient.upsertUsers()` call before `call.getOrCreate()`, registering the psychologist (id=userId, name=psychologistName) and, if patientId is present, the patient (id=`patient-<patientId>`, name=patientFullName). Skip upsert on the idempotent early-return path (room already exists). Update the callers: `createVideoRoomImpl` in `src/modules/telepsicologia/server/create-video-room.ts` (fetch `profiles.fullName` + `patients.fullName` from the existing DB queries and pass them through) and `auto-create-room.ts` Inngest function (add the profile/patient name queries if not already present, pass them to the helper).

- [x] 1.2 Update the unit test `src/__tests__/unit/modules/telepsicologia/server/create-video-room-helper.test.ts`: add `upsertUsers` to the mock `StreamClient`, assert it is called with both psychologist and patient users before `getOrCreate` on the happy path, and assert it is NOT called on the idempotent early-return path (room already exists). Update `SessionData` fixture to include `psychologistName` and `patientFullName`.

- [x] 1.3 Update the integration test `src/__tests__/integration/telepsicologia/create-video-room.int.test.ts`: add `upsertUsers` to the mock Stream client (`vi.fn().mockResolvedValue({})`), assert it is called with the correct user IDs and names on room creation. Verify the mock is NOT called when the room already exists (idempotent path).

- [x] 1.4 Update the integration test `src/__tests__/integration/telepsicologia/auto-create-room.int.test.ts`: add `upsertUsers` to the mock Stream client, assert it is called when the Inngest auto-create function creates a room.

## 2. Upsert psychologist on token minting + tests

- [x] 2.1 In `get-video-token.ts`, after verifying room ownership (step 3) and before generating the call token (step 5): fetch the psychologist's `profiles.fullName` from the DB (scoped by `userId`), then call `streamClient.upsertUsers()` with the psychologist's UUID and current name. This ensures the display name is fresh at the moment the psychologist opens the video page.

- [x] 2.2 Update the integration test `src/__tests__/integration/telepsicologia/get-video-token.int.test.ts`: add `upsertUsers` to the mock Stream client, assert it is called with the psychologist's user ID and profile name before `generateCallToken` on the successful token minting path.

## 3. Upsert patient on join route + tests

- [x] 3.1 In `src/app/api/video/join/route.ts`, in the `status === 'active'` branch (before returning the Stream JWT): import `getStreamClient` from `@/modules/telepsicologia/server/stream-client`, determine the patient's synthetic user ID from the stored JWT's `user_id` claim (parse the `patientJwt`/`partnerJwt` payload to extract `user_id`, OR reconstruct it from the room data — prefer reconstructing from the session/patient data stored in the room, avoiding JWT parsing). Fetch the patient's display name from the `patients` table (requires joining through `sessions` → `patients` using the room's `sessionId`). Call `streamClient.upsertUsers()` with the synthetic user ID and patient name. Wrap in try/catch — if upsert fails, return 500 `{ error: 'INTERNAL_ERROR' }`.

- [x] 3.2 Update the integration test `src/__tests__/integration/telepsicologia/video-join-handler.int.test.ts`: mock the Stream client module (`vi.mock('@/modules/telepsicologia/server/stream-client', ...)`), add `upsertUsers` to the mock. Assert that when the route returns `status === 'active'`, `upsertUsers` was called with the correct patient synthetic user ID and display name. Assert it is NOT called for 'waiting', 'too_early', or error responses.

## 4. Client-side error logging + tests

- [ ] 4.1 In `src/modules/telepsicologia/components/pre-call-lobby.tsx`, update the `call.join().catch()` handler (line ~123): capture the error parameter and call `console.error('[telepsicologia] call.join failed', err)` before setting the permission error state.

- [ ] 4.2 In `src/modules/telepsicologia/components/patient-in-call-view.tsx`, update the `call.join().catch()` handler (line ~428): capture the error parameter and call `console.error('[telepsicologia] call.join failed', err)`.

- [ ] 4.3 Update the unit test `src/__tests__/unit/modules/telepsicologia/components/pre-call-lobby.test.tsx`: add a test that when `mockJoin` rejects with an error, `console.error` is called with the `[telepsicologia]` prefix and the actual error object. Use `vi.spyOn(console, 'error')`.
