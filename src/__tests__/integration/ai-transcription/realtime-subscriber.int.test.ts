/**
 * Integration test for the client-side Realtime subscriber
 * (`useAiTranscriptionRealtime` mounted via `<AiRealtimeBoundary>`).
 *
 * SKIPPED: the same constraint as `realtime-broadcast.int.test.ts` applies.
 * Supabase Realtime (the WebSocket server) is NOT part of the Testcontainers
 * setup used by the integration suite — the `postgres:15` image provides only
 * the database engine, not the full Supabase stack (GoTrue, Realtime, Storage).
 *
 * A faithful version of this test ("boot the layout, send a real broadcast via
 * `broadcastAiReady`, assert the Sonner toast appears") requires:
 *   1. a running Realtime server so the browser-side `.subscribe()` connects;
 *   2. a real GoTrue session so the layout resolves a `userId`;
 *   3. a jsdom/Playwright DOM to observe the toast.
 * None of these are available under Testcontainers-only CI.
 *
 * The subscriber's behaviour is fully covered by the unit test
 * (`src/__tests__/unit/modules/ai-transcription/hooks/use-ai-transcription-realtime.test.ts`):
 * correct channel name (`user:<userId>`), `ai-transcription:ready` event
 * binding, TanStack invalidation of `['ai-transcriptions','list']` and
 * `['ai-transcriptions','ready-count']`, the Sonner toast + "Ver" action link,
 * and channel teardown on unmount.
 *
 * TODO: if a full Supabase local stack (`supabase start`) becomes available in
 * CI, unskip and implement the end-to-end subscribe → broadcast → toast flow
 * described below.
 */

import { describe, it } from 'vitest';

describe.skip('useAiTranscriptionRealtime — end-to-end via Realtime (requires full Supabase stack)', () => {
  it('shows a toast when a real ready broadcast arrives on the user channel', () => {
    // Render <AiRealtimeBoundary userId={userA_id} /> with a real browser
    //   Supabase client pointed at the local Realtime server.
    // Run broadcastAiReady({ userId: userA_id, transcriptionId }).
    // Assert a Sonner toast "Nova nota IA pronta para revisão" appears with a
    //   "Ver" action linking to /dashboard/transcricoes/<transcriptionId>/revisar.
  });

  it('does NOT show a toast for a broadcast addressed to another user', () => {
    // Render the boundary for userB_id.
    // Run broadcastAiReady({ userId: userA_id, transcriptionId }).
    // Wait a short timeout; assert no toast appeared.
  });
});
