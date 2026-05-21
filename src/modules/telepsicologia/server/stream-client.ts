import 'server-only';

import { StreamClient } from '@stream-io/node-sdk';

import { serverEnv } from '@/shared/env';

// Lazy singleton — never initialized at import time (test-friendly).
let _client: StreamClient | null = null;

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
    _client = new StreamClient(serverEnv.STREAM_API_KEY, serverEnv.STREAM_API_SECRET);
  }
  return _client;
}
