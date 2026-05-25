import { describe, it } from 'vitest';

// ---------------------------------------------------------------------------
// Storage RLS validation for the `ai-transcription-audio` bucket.
//
// SKIPPED: The Testcontainers setup in this project only provides raw Postgres
// — it does NOT run the Supabase stack (GoTrue, Kong, Storage API). This means
// `supabase.storage.from('bucket').upload(...)` and `.download(...)` cannot be
// tested against the test Postgres container.
//
// The policies SQL is already verified by ai-transcription-schema.int.test.ts
// (pg_policies query confirms the CREATE POLICY statements executed). What this
// test WOULD add is end-to-end proof through the Supabase Storage API.
//
// To run these tests in the future:
// 1. Start the full local Supabase stack: `supabase start`
// 2. Move these tests to the `@auth-real` e2e suite
//    (`src/__tests__/e2e/real/`) which uses a real GoTrue + Storage API.
// 3. Remove the `.skip` and provide real user JWTs via `supabase.auth.signUp`.
//
// What would be tested:
// - User A uploads an object under `userA/<transcriptionId>/audio.webm`.
// - User B cannot `download` that object via their RLS-scoped Supabase client.
// - User B cannot `list` objects under `userA/` via their RLS-scoped client.
// - User A CAN download and list their own objects.
// - User A CAN delete their own objects.
// - User B cannot delete user A's objects.
// ---------------------------------------------------------------------------

describe.skip('ai-transcription-audio storage RLS (requires supabase start)', () => {
  it('user A can upload an object under their own prefix', () => {
    // Would use: supabase.storage.from('ai-transcription-audio').upload(
    //   `${userA}/${transcriptionId}/audio.webm`, buffer, { contentType: 'audio/webm' }
    // )
  });

  it('user B cannot download an object belonging to user A', () => {
    // Would use: supabase.storage.from('ai-transcription-audio').download(
    //   `${userA}/${transcriptionId}/audio.webm`
    // )
    // Expect: error / empty response
  });

  it('user B cannot list objects under user A prefix', () => {
    // Would use: supabase.storage.from('ai-transcription-audio').list(userA)
    // Expect: empty array
  });

  it('user A can list and download their own objects', () => {
    // Would use: supabase.storage.from('ai-transcription-audio').list(userA)
    // Expect: array with the uploaded object
  });

  it('user A can delete their own objects', () => {
    // Would use: supabase.storage.from('ai-transcription-audio').remove(
    //   [`${userA}/${transcriptionId}/audio.webm`]
    // )
    // Expect: success
  });

  it('user B cannot delete objects belonging to user A', () => {
    // Would use: supabase.storage.from('ai-transcription-audio').remove(
    //   [`${userA}/${transcriptionId}/audio.webm`]
    // )
    // Expect: error / no effect
  });
});
