import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any import that transitively reaches the mocked
// modules.  `vi.mock` is hoisted by Vitest, so declaration order is safe.
// ---------------------------------------------------------------------------

const MockStreamClient = vi.fn();

vi.mock('@stream-io/node-sdk', () => ({
  StreamClient: MockStreamClient,
}));

vi.mock('@/shared/env', () => ({
  serverEnv: {
    STREAM_API_KEY: 'fake-api-key',
    STREAM_API_SECRET: 'fake-api-secret',
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getStreamClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module registry so the lazy singleton (`_client`) is cleared
    // between tests — each test gets a fresh module evaluation.
    vi.resetModules();
  });

  async function importFresh() {
    const mod = await import('@/modules/telepsicologia/server/stream-client');
    return mod;
  }

  it('creates a StreamClient with credentials from serverEnv on first call', async () => {
    const { getStreamClient } = await importFresh();

    getStreamClient();

    expect(MockStreamClient).toHaveBeenCalledOnce();
    expect(MockStreamClient).toHaveBeenCalledWith('fake-api-key', 'fake-api-secret');
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    const { getStreamClient } = await importFresh();

    const first = getStreamClient();
    const second = getStreamClient();

    expect(first).toBe(second);
    // Constructor called only once despite two getStreamClient() calls.
    expect(MockStreamClient).toHaveBeenCalledOnce();
  });
});
