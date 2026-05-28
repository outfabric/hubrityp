/**
 * Integration test for Realtime broadcast isolation.
 *
 * SKIPPED: Supabase Realtime (WebSocket server) is not available in the
 * Testcontainers Postgres setup used by the integration test suite. The
 * Testcontainers image (`postgres:15`) provides only the database engine,
 * not the full Supabase stack (GoTrue, Realtime, Storage, etc.).
 *
 * To properly test channel isolation (user A receives `ready`, user B does
 * NOT), a full Supabase local stack (`supabase start`) or a dedicated
 * Realtime test server is required. This is not available in CI.
 *
 * The broadcast function itself is covered by unit tests
 * (`src/__tests__/unit/modules/ai-transcription/server/realtime/broadcast.test.ts`)
 * which verify the correct channel name, event shape, payload, cleanup,
 * and error swallowing via mocked Supabase client.
 *
 * If a full Supabase local stack becomes available in CI, unskip this
 * test and implement the two-client subscribe/assert flow described below.
 */

import { describe, it } from 'vitest';

describe.skip('broadcastAiReady — Realtime channel isolation (requires full Supabase stack)', () => {
  it('user A receives the ready event after pipeline completes for A', () => {
    // Subscribe client A to channel `user:<userA_id>`.
    // Run broadcastAiReady({ userId: userA_id, transcriptionId }).
    // Assert client A receives { event: 'ai-transcription:ready', payload: { transcriptionId } }.
  });

  it('user B does NOT receive the ready event for user A', () => {
    // Subscribe client B to channel `user:<userB_id>`.
    // Run broadcastAiReady({ userId: userA_id, transcriptionId }).
    // Wait a short timeout; assert client B received no messages.
  });
});
