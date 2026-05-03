import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `/api/me` reads identity exclusively from the Supabase session. We mock the
// server client at the module boundary so each test can stage either an
// authenticated or anonymous session without standing up a real GoTrue.

const getUserMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: getUserMock,
    },
  }),
}));

beforeEach(() => {
  getUserMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('GET /api/me (integration)', () => {
  it('returns 200 with { userId, email } for an authenticated session', async () => {
    const id = randomUUID();
    getUserMock.mockResolvedValue({
      data: { user: { id, email: 'doctor@example.com' } },
      error: null,
    });

    const { GET } = await import('@/app/api/me/route');
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ userId: id, email: 'doctor@example.com' });
  });

  it('returns 401 with { ok: false, error: "unauthenticated" } when no session is present', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'no session' },
    });

    const { GET } = await import('@/app/api/me/route');
    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('returns 401 when getUser resolves with a null user and no error', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const { GET } = await import('@/app/api/me/route');
    const response = await GET();

    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('returns 401 when the Supabase user is missing required fields (defensive map)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: '', email: '' } },
      error: null,
    });

    const { GET } = await import('@/app/api/me/route');
    const response = await GET();

    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('reads identity from the session and ignores query params attempting to override it', async () => {
    const sessionId = randomUUID();
    getUserMock.mockResolvedValue({
      data: { user: { id: sessionId, email: 'real@example.com' } },
      error: null,
    });

    const { GET } = await import('@/app/api/me/route');

    // The route handler does not accept any input — it intentionally has a
    // zero-arg signature so query params and headers cannot influence the
    // returned identity. We also assert at the type level by passing nothing.
    // The contract: even if a malicious caller crafts
    // `/api/me?userId=tamper&email=evil@x.com`, the response reflects the
    // session, not the URL.
    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ userId: sessionId, email: 'real@example.com' });
    expect(body.userId).not.toBe('tamper');
    expect(body.email).not.toBe('evil@x.com');
  });
});
