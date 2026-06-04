## Why

The telepsychology video call feature is broken in production: psychologists cannot enter video rooms. When clicking "Entrar na sessão", the client-side `call.join()` fails silently and shows a generic error. The root cause is that **neither the psychologist nor the patient user IDs are ever registered in Stream's user database via `upsertUsers()`**. Server-side operations (call creation, token generation) succeed because they use admin API key+secret, but the client-side SDK cannot authenticate users that don't exist in Stream. This is a P0 — the entire telepsychology feature is non-functional.

## What Changes

- **Add `streamClient.upsertUsers()` during room creation**: register the psychologist (Supabase UUID + profile name) and the patient (`patient-<patientId>` + patient name) in Stream before creating the call. This happens in the shared helper used by both the Server Action and the Inngest auto-create function.
- **Add idempotent `upsertUsers()` on psychologist token minting**: ensures the psychologist user is up-to-date in Stream when they actually open the video page (covers cases where the room was created by the Inngest auto-create job with potentially stale data).
- **Add `upsertUsers()` for patient on join route**: register the patient/partner user in Stream right before returning the Stream JWT in the `/api/video/join` Route Handler (the moment before the patient will actually use the token).
- **Improve error handling in client-side join**: log the actual Stream error in `call.join()` catch blocks (both psychologist lobby and patient in-call view) instead of swallowing it, making future debugging possible.

## Capabilities

### New Capabilities

_(none — this is a bugfix to existing capabilities)_

### Modified Capabilities

- `telepsicologia-token-minting`: Room creation and token minting must register users in Stream via `upsertUsers()` before creating calls or generating tokens.
- `telepsicologia-patient-join`: The `/api/video/join` Route Handler must register the patient/partner user in Stream before returning the Stream JWT.
- `telepsicologia-troubleshooting`: Client-side `call.join()` error handling must log the actual Stream error instead of swallowing it.

## Impact

- **Server code**: `create-video-room-helper.ts`, `get-video-token.ts`, `/api/video/join/route.ts` gain `upsertUsers()` calls
- **Client code**: `pre-call-lobby.tsx`, `patient-in-call-view.tsx` get improved error logging
- **Dependencies**: No new dependencies — `upsertUsers()` is already part of the `@stream-io/node-sdk` `StreamClient` that is imported and used
- **Stream API**: Additional API calls to Stream (upsert is idempotent, safe for repeated calls)
- **Tests**: Unit and integration tests must verify `upsertUsers` is called with correct user data
