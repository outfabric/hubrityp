import 'server-only';

import { StreamClient } from '@stream-io/node-sdk';

import { serverEnv } from '@/shared/env';

// Lazy singleton — never initialized at import time (test-friendly).
let _client: StreamClient | null = null;

/**
 * Builds an in-memory no-op Stream client for the seeded Playwright suite.
 *
 * The e2e server boots `next start` with dummy Stream credentials and has no
 * network path to Stream's API, so any real SDK call (`upsertUsers`,
 * `generateCallToken`, `video.call(...).getOrCreate()`) would hang or throw —
 * turning, e.g., the patient-join route's defensive `upsertUsers` into a 500.
 *
 * This stub is only ever returned when `serverEnv.E2E_STREAM_STUB` is true,
 * which is set EXCLUSIVELY by the seeded e2e server bootstrap. Production and
 * dev never set the flag, so the real SDK path is byte-for-byte unchanged
 * there. The cast is intentional and confined to this factory: we implement
 * only the surface the server paths exercise, mirroring how the integration
 * suite mocks `getStreamClient` via `vi.mock`.
 */
function buildE2eStreamStub(): StreamClient {
  const noop = Promise.resolve(undefined);
  const stub = {
    upsertUsers: () => noop,
    generateCallToken: () => 'e2e-stub-call-token',
    video: {
      call: () => ({
        getOrCreate: () => noop,
        endCall: () => noop,
        delete: () => noop,
        startRecording: () => noop,
        stopRecording: () => noop,
      }),
    },
  };
  // The stub deliberately implements only the methods reachable from
  // server-side code paths in the seeded e2e flow.
  return stub as unknown as StreamClient;
}

/**
 * Returns the Stream Node SDK client, creating it on first call.
 *
 * Credentials are read from `serverEnv` (Zod-validated at boot), so this
 * function never touches `process.env` directly.  The singleton is kept in
 * module scope and reused across the process lifetime — safe for both
 * long-lived servers and short-lived serverless invocations (each cold start
 * gets a fresh module scope).
 */
export function getStreamClient(): StreamClient {
  if (!_client) {
    _client = serverEnv.E2E_STREAM_STUB
      ? buildE2eStreamStub()
      : new StreamClient(serverEnv.STREAM_API_KEY, serverEnv.STREAM_API_SECRET);
  }
  return _client;
}
