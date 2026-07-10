import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileStatus } from '@/modules/registration';
import type * as RegistrationEdgeModule from '@/modules/registration/edge';

// Subtask 6.5 — negative-auth for the WhatsApp UI surfaces. The granular
// `NEXT_PUBLIC_WHATSAPP_*` UI feature flags freeze navigation entry points only;
// auth gating of the underlying routes stays the middleware's job. This suite
// proves the two WhatsApp routes remain gated for anonymous requests
// REGARDLESS of the flag values:
//   - `/configuracoes/lembretes` — reminder settings (REMINDERS flag surface).
//     Resolves to the `'app'` (gated) class via the `/configuracoes` prefix.
//   - `/caixa-de-entrada` — WhatsApp inbox (INBOX flag surface). Has its own
//     `/caixa-de-entrada` classifier entry, also `'app'`.
//
// The flags are `NEXT_PUBLIC_*` (client-inlined UI toggles); the edge middleware
// never reads them for the auth decision, so toggling them cannot open a gated
// route. We still exercise both flag configurations (MVP-on and all-off) to
// document that the negative-auth guarantee is flag-independent.
//
// Coverage (per specs/middleware-gating/spec.md + whatsapp-ui-feature-flag/spec.md):
//   - Anonymous -> 307 to /login?redirectTo=<route> (the key negative-auth proof)
//   - Active user -> pass through (positive-auth sanity)

const { getUserMock, getCurrentProfileEdgeMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getCurrentProfileEdgeMock: vi.fn(),
}));

const signOutMock = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));

vi.mock('@/shared/supabase/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    createMiddlewareClient: vi.fn((request: NextRequest) => {
      const response = NextResponse.next({ request });
      return {
        supabase: {
          auth: {
            getUser: getUserMock,
            signOut: signOutMock,
          },
        },
        response,
      };
    }),
  };
});

vi.mock('@/modules/registration/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof RegistrationEdgeModule>();
  return {
    ...actual,
    getCurrentProfileEdge: getCurrentProfileEdgeMock,
  };
});

beforeEach(() => {
  getUserMock.mockReset();
  getCurrentProfileEdgeMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// -- Session fixtures ---------------------------------------------------------

const FAKE_USER_ID = '00000000-0000-4000-8000-000000000002';

function asAnon() {
  getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
  getCurrentProfileEdgeMock.mockResolvedValue(null);
}

function profileWithStatus(status: ProfileStatus) {
  return {
    userId: FAKE_USER_ID,
    email: 'doctor@example.com',
    fullName: 'Dr. Test',
    crpNumber: '12345',
    crpUf: 'SP',
    crpValidatedAt: null,
    crpValidatedBy: null,
    emailVerifiedAt: null,
    status,
    termsAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
    sensitiveDataConsentAt: new Date(),
    lastResendAt: null,
    failedLoginCount: 0,
    lastFailedLoginAt: null,
    lockoutUntil: null,
    consecutiveLockouts: 0,
    requiresPasswordReset: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function asActiveUser() {
  getUserMock.mockResolvedValue({
    data: {
      user: {
        id: FAKE_USER_ID,
        email: 'doctor@example.com',
        app_metadata: { provider: 'email', providers: ['email'] },
      },
    },
    error: null,
  });
  getCurrentProfileEdgeMock.mockResolvedValue(profileWithStatus(ProfileStatus.Active));
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function parseLocation(response: Response): URL {
  const loc = response.headers.get('location');
  if (!loc) throw new Error('expected a Location header on the response');
  return new URL(loc, 'http://localhost');
}

function expectPass(response: Response) {
  expect(response.headers.get('location')).toBeNull();
  expect(response.status).toBeLessThan(300);
}

/** Applies the three granular WhatsApp UI flags to `process.env` for one case. */
function stubWhatsappFlags(reminders: string, inbox: string, connection: string) {
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED', reminders);
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED', inbox);
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED', connection);
}

// -- Tests --------------------------------------------------------------------

const LEMBRETES_PATH = '/configuracoes/lembretes';
const INBOX_PATH = '/caixa-de-entrada';

// Flag matrices under which the gating must be identical. The first row is the
// MVP target; the second is the all-frozen default.
const FLAG_CONFIGS = [
  { name: 'MVP (reminders on, inbox/connection off)', flags: ['true', 'false', 'false'] as const },
  { name: 'all flags off (default)', flags: ['false', 'false', 'false'] as const },
];

describe.each([
  { label: 'reminder settings', path: LEMBRETES_PATH },
  { label: 'WhatsApp inbox', path: INBOX_PATH },
])('middleware gates $label ($path) regardless of UI flags', ({ path }) => {
  describe.each(FLAG_CONFIGS)('with $name', ({ flags }) => {
    beforeEach(() => {
      stubWhatsappFlags(flags[0], flags[1], flags[2]);
    });

    it('redirects an anonymous request to /login with the original redirectTo', async () => {
      asAnon();
      const { middleware } = await import('@/middleware');
      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      const url = parseLocation(response);
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('redirectTo')).toBe(path);
    });

    it('passes an active user through (flags do not block the route)', async () => {
      asActiveUser();
      const { middleware } = await import('@/middleware');
      expectPass(await middleware(makeRequest(path)));
    });
  });
});
