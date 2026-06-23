import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RESEND_CONFIRMATION_ACK } from '@/modules/registration';
import {
  PENDING_EMAIL_COOKIE_NAME,
  setPendingEmailCookie,
} from '@/shared/lib/cookies/pending-email';

// Integration coverage for the PUBLIC, sessionless resend action
// (`resendPublicConfirmationImpl`). Maps to the `public-email-confirmation`
// requirement "Anonymous resend is enumeration-safe…".
//
// The action MUST be indistinguishable across every Supabase outcome:
//
//   • Supabase 200 (success), 422 (user-not-found), and 429 (rate-limited) all
//     resolve to the IDENTICAL generic result and drive the IDENTICAL pt-BR
//     copy — a caller cannot probe which addresses are registered.
//   • A missing pending-email cookie performs NO Supabase call at all.
//   • A tampered cookie (bad HMAC) is treated as absent — also no Supabase call.
//
// The target email is read ONLY from the verified `hp_pending_email` cookie,
// never from client input. We mock `next/headers` to control the cookie store
// and `@/shared/supabase/server` to observe how `auth.resend` is invoked. The
// cookie value itself is produced with the REAL `setPendingEmailCookie`, so the
// HMAC the action recomputes on read matches a genuinely-signed cookie (the
// `PENDING_EMAIL_COOKIE_SECRET` is fixed by the integration global-setup).

const { resendMock, cookieGetMock } = vi.hoisted(() => ({
  resendMock: vi.fn(),
  cookieGetMock: vi.fn<(name: string) => { value: string } | undefined>(),
}));

vi.mock('@/shared/supabase/server', () => ({
  // The action only consumes `auth.resend`. The factory returns a Promise to
  // mirror the production async builder.
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        resend: resendMock,
      },
    }),
  ),
}));

vi.mock('next/headers', () => ({
  // `cookies()` is awaited by the action; we expose only the readable `get`
  // surface the cookie helper needs.
  cookies: vi.fn(() => Promise.resolve({ get: cookieGetMock })),
}));

/**
 * Produce a genuinely-signed `hp_pending_email` cookie value for `email` by
 * driving the real writer against an in-memory store and reading back what it
 * set. This guarantees the HMAC matches what `readPendingEmail` recomputes.
 */
function signedCookieValue(email: string): string {
  let captured: string | undefined;
  setPendingEmailCookie(
    {
      set: (name, value) => {
        if (name === PENDING_EMAIL_COOKIE_NAME) captured = value;
      },
    },
    email,
  );
  if (captured === undefined) throw new Error('failed to capture signed cookie value');
  return captured;
}

/** Make the mocked cookie store return `value` for the pending-email cookie. */
function withCookie(value: string | undefined): void {
  cookieGetMock.mockImplementation((name) =>
    name === PENDING_EMAIL_COOKIE_NAME && value !== undefined ? { value } : undefined,
  );
}

const VALID_EMAIL = 'maria@test.local';

beforeEach(() => {
  resendMock.mockReset();
  cookieGetMock.mockReset();
  // Default: a valid signed cookie is present. Individual cases override.
  withCookie(signedCookieValue(VALID_EMAIL));
});

afterEach(() => {
  vi.resetModules();
});

describe('resendPublicConfirmationImpl (integration, enumeration-safe)', () => {
  it.each([
    ['200 success', { error: null }],
    ['422 user-not-found', { error: { name: 'AuthApiError', status: 422 } }],
    ['429 rate-limited', { error: { name: 'AuthApiError', status: 429 } }],
  ])(
    'returns the identical generic result and copy for Supabase %s',
    async (_label, supabaseResult) => {
      resendMock.mockResolvedValue(supabaseResult);

      const { resendPublicConfirmationImpl } =
        await import('@/modules/registration/server/resend-public');
      const result = await resendPublicConfirmationImpl();

      // Identical result shape regardless of the Supabase outcome.
      expect(result).toEqual({ ok: true });
      // The action was driven by the cookie email, never by client input.
      expect(resendMock).toHaveBeenCalledTimes(1);
      expect(resendMock).toHaveBeenCalledWith({ type: 'signup', email: VALID_EMAIL });
      // Identical pt-BR copy across all three branches — asserted explicitly so
      // a future copy fork between outcomes would fail this test.
      expect(RESEND_CONFIRMATION_ACK).toBe(
        'Se houver um cadastro com este email, reenviamos o link de confirmação.',
      );
    },
  );

  it('produces the same result for 200, 422, and 429 (no observable difference)', async () => {
    const { resendPublicConfirmationImpl } =
      await import('@/modules/registration/server/resend-public');

    resendMock.mockResolvedValueOnce({ error: null });
    const ok = await resendPublicConfirmationImpl();

    resendMock.mockResolvedValueOnce({ error: { name: 'AuthApiError', status: 422 } });
    const notFound = await resendPublicConfirmationImpl();

    resendMock.mockResolvedValueOnce({ error: { name: 'AuthApiError', status: 429 } });
    const rateLimited = await resendPublicConfirmationImpl();

    expect(ok).toEqual(notFound);
    expect(notFound).toEqual(rateLimited);
    expect(ok).toEqual({ ok: true });
  });

  it('performs NO Supabase call when the pending-email cookie is absent', async () => {
    withCookie(undefined);

    const { resendPublicConfirmationImpl } =
      await import('@/modules/registration/server/resend-public');
    const result = await resendPublicConfirmationImpl();

    expect(result).toEqual({ ok: true });
    expect(resendMock).not.toHaveBeenCalled();
  });

  it('treats a tampered cookie (bad HMAC) as absent — NO Supabase call', async () => {
    const valid = signedCookieValue(VALID_EMAIL);
    // Flip the last character of the signature to break the HMAC while keeping
    // the structural `<email>.<sig>` shape intact.
    const lastChar = valid.slice(-1);
    const tampered = valid.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');
    withCookie(tampered);

    const { resendPublicConfirmationImpl } =
      await import('@/modules/registration/server/resend-public');
    const result = await resendPublicConfirmationImpl();

    expect(result).toEqual({ ok: true });
    expect(resendMock).not.toHaveBeenCalled();
  });

  it('never throws even when Supabase rejects', async () => {
    resendMock.mockRejectedValue(new Error('network down'));

    const { resendPublicConfirmationImpl } =
      await import('@/modules/registration/server/resend-public');

    await expect(resendPublicConfirmationImpl()).resolves.toEqual({ ok: true });
    expect(resendMock).toHaveBeenCalledTimes(1);
  });
});
