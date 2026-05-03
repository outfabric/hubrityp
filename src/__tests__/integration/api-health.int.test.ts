import { afterEach, describe, expect, it, vi } from 'vitest';

// `/api/health` is a public probe. These tests exercise the real Drizzle path
// (reachable case) and a forced failure path (unreachable case) using
// `vi.doMock` so the failure stub is scoped to a single test.

afterEach(() => {
  // Clear any per-test `vi.doMock('@/shared/db/client', ...)` so the next test
  // loads the real Drizzle client. Without `doUnmock`, the mock factory
  // persists across tests because Vitest registers it globally for the test
  // file.
  vi.doUnmock('@/shared/db/client');
  vi.resetModules();
});

describe('GET /api/health (integration)', () => {
  it('returns 200 with db: "reachable" when the database responds', async () => {
    const { GET } = await import('@/app/api/health/route');

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.db).toBe('reachable');
    expect(typeof body.timestamp).toBe('string');
    expect(() => new Date(body.timestamp as string).toISOString()).not.toThrow();
  });

  it('returns 503 with db: "unreachable" when the Drizzle probe throws', async () => {
    vi.resetModules();
    vi.doMock('@/shared/db/client', () => ({
      db: {
        execute: vi.fn().mockRejectedValue(new Error('connection refused')),
      },
    }));

    const { GET } = await import('@/app/api/health/route');
    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.db).toBe('unreachable');
    expect(typeof body.timestamp).toBe('string');
  });

  it('exposes only the documented keys (no PII, no env, no stack traces)', async () => {
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['db', 'ok', 'timestamp']);
  });

  it('does not require authentication and does not set auth cookies', async () => {
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();

    // The response carries no Set-Cookie headers — the handler never reaches
    // for `cookies()` or the Supabase server client, so there is nothing to
    // write back to the browser.
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.status).toBe(200);
  });
});
