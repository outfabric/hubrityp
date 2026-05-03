import { describe, expect, it, vi } from 'vitest';

import type * as authModule from '@/modules/auth';

// Integration smoke for the `/signup` route shell + page modules.
//
// The deeper Server Action behaviour (validation, Supabase user create,
// transactional profile insert, compensating delete) is covered exhaustively
// by `src/__tests__/integration/modules/auth/server/signup.int.test.ts`.
// This file pins two narrower contracts that ARE the route shell's job:
//
//   1. `src/app/(auth)/signup/actions.ts` re-exports the impl as an async
//      function reachable through Next's Server Action surface, and the
//      `SignUpResult` type re-export resolves at runtime.
//   2. `src/app/(auth)/signup/page.tsx` evaluates without throwing — the
//      module-level imports (SignupForm, createServerClient, the action,
//      the Card primitives) must all resolve cleanly. We do NOT call the
//      default export: it requires a Next request context (`cookies()`,
//      `headers()`) that lives only inside the production runtime.

// Mock Supabase + the impl so the shell evaluation does not try to read
// cookies or speak to a real backend during module load.
vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/modules/auth', async () => {
  const actual = await vi.importActual<typeof authModule>('@/modules/auth');
  return {
    ...actual,
    signUp: vi.fn().mockResolvedValue({ ok: true, redirectTo: '/auth/verify-email' }),
  };
});

describe('signup route shell — module surface', () => {
  it('actions.ts exposes `signUp` as a function and forwards to the impl', async () => {
    const shell = await import('@/app/(auth)/signup/actions');
    expect(typeof shell.signUp).toBe('function');

    const result = await shell.signUp(new FormData());
    // The mock returns `{ ok: true, redirectTo: '/auth/verify-email' }`. We
    // assert via the discriminant only — the route shell's job is to be a
    // transparent forwarder, not to re-shape the result.
    expect(result).toMatchObject({ ok: true });
  });

  it('page.tsx module loads without throwing at import time', async () => {
    // The default export is an async Server Component that requires a Next
    // request context to actually invoke. Importing alone is enough to
    // verify the import graph is healthy (which is the integration value
    // we want over a unit test).
    const pageModule = await import('@/app/(auth)/signup/page');
    expect(typeof pageModule.default).toBe('function');
  });
});
