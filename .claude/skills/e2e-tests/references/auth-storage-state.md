# Reusable authentication with `storageState`

Login via UI in every test is the biggest source of slowness and flakiness. The recipe: authenticate **once** in a setup project, save cookies/localStorage to a file, reuse in every test that needs it.

## Overall flow (seeded suite)

1. `webServer.command` → `src/__tests__/e2e/seeded/setup/start-server.ts` boots the shared Postgres, applies migrations, starts mock GoTrue and spawns `next start`.
2. Playwright `globalSetup` (`src/__tests__/e2e/seeded/setup/global-setup.ts`) seeds users in `auth.users` + base data.
3. The setup project (`src/__tests__/e2e/seeded/setup/auth.setup.ts`) does a programmatic signin against the mock GoTrue → writes `storageState` to `src/__tests__/e2e/seeded/setup/.auth/state.json`.
4. Tests opt in via `test.use({ storageState: STORAGE_STATE_PATH })`. Each test starts logged in in <100ms.

## Programmatic signin against mock GoTrue

In seeded E2E, auth is simulated by:

1. A mock GoTrue HTTP server (in `src/__tests__/e2e/seeded/setup/mock-gotrue.ts`) listening on `127.0.0.1:54321` (hardcoded port — see "Critical notes" in SKILL.md).
2. `start-server.ts` builds a valid JWT (HS256, payload with `sub`, `email`, `aud`, `role`, `exp` in the future) and configures the mock to return that same token + user on `GET /auth/v1/user`.
3. Inserting the user into `auth.users` (with the same `sub` UUID) is done by `globalSetup`.
4. `auth.setup.ts` uses `@supabase/ssr` to call `supabase.auth.setSession({ access_token, refresh_token })`. The lib calls `setAll` with the cookies in the expected format; we capture and write to `storageState`.

```ts
// src/__tests__/e2e/seeded/setup/auth.setup.ts
import { writeFile } from 'node:fs/promises';
import { test as setup } from '@playwright/test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { readSeedState, STORAGE_STATE_PATH } from './seed-state';

setup('write simulated auth state', async () => {
  const seed = await readSeedState();
  const captured: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(seed.supabaseUrl, 'e2e-anon-key', {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => { captured.push(...cookiesToSet); },
    },
  });

  const { error } = await supabase.auth.setSession({
    access_token: seed.accessToken,
    refresh_token: seed.refreshToken,
  });
  if (error) throw new Error(`auth.setup: ${error.message}`);

  const cookies = captured.map((c) => ({
    name: c.name,
    value: c.value,
    domain: 'localhost',
    path: c.options.path ?? '/',
    expires: Math.floor(Date.now() / 1000) + (c.options.maxAge ?? 86_400),
    httpOnly: c.options.httpOnly ?? false,
    secure: false,            // baseURL is http (no TLS); a Secure cookie would be discarded
    sameSite: 'Lax' as const,
  }));

  await writeFile(STORAGE_STATE_PATH, JSON.stringify({ cookies, origins: [] }, null, 2));
});
```

The advantage of delegating to `@supabase/ssr` instead of hand-rolling the cookie: the name (`sb-<projectRef>-auth-token`), encoding (`base64-` + base64url) and chunking strategy are all correct without the test having to know.

## Real suite (`@auth-real`)

The real suite operates against the GoTrue from `supabase start` and does not use a global `storageState`. Each spec logs in via the UI or via API (`supabase.auth.signInWithPassword`), validates the real path end-to-end, and the real GoTrue cookie carries state for the rest of the flow.

`src/__tests__/e2e/real/setup/credentials.ts` keeps the emails/passwords of the seed users that `globalSetup` creates via `supabase.auth.admin.createUser` (using the `SERVICE_ROLE_KEY` read at config-load).

## Multiple user profiles (seeded suite)

If the suite needs "psychologist A" and "psychologist B" (e.g., test isolation), create a setup project for each and multiple `storageState`s:

```ts
// playwright.seeded.config.ts
projects: [
  { name: 'setup-dr-a', testMatch: /auth-dr-a\.setup\.ts/ },
  { name: 'setup-dr-b', testMatch: /auth-dr-b\.setup\.ts/ },
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },                  // no storageState here
    dependencies: ['setup-dr-a', 'setup-dr-b'],
  },
];
```

Each test opts in to the state it needs:

```ts
import { STORAGE_STATE_PATH_A, STORAGE_STATE_PATH_B } from './setup/seed-state';

test.describe('isolation per psychologist', () => {
  test.use({ storageState: STORAGE_STATE_PATH_A });
  test('dr_a sees only their patients', /* ... */);
});

test('dr_b does not see dr_a data', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE_PATH_B });
  const page = await ctx.newPage();
  // ...
});
```

## Worker-scoped (isolated parallel accesses)

For suites where each worker needs a **unique account** (e.g., test account creation with isolated mutations), use a worker-scoped fixture that creates the account on-demand. Details in [Playwright auth docs](https://playwright.dev/docs/auth#authenticate-with-api-request).

In HubrityP, the default path is **a shared seed user** — faster and sufficient for 90% of flows. Multiple profiles only where there is an isolation assertion between them.

## Logout / expired session

To test the logout flow or an expired token, **do not** touch the global `storageState`. Create a new context:

```ts
test('redirects to /login when token expires', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
```

## Checklist

- [ ] `auth.setup.ts` is idempotent (seed user insert uses `ON CONFLICT DO NOTHING`).
- [ ] `src/__tests__/e2e/seeded/setup/.auth/` is in `.gitignore`.
- [ ] Cookies written with `domain: 'localhost'` + `secure: false` (HTTP baseURL in dev/CI).
- [ ] Seed user never modified by tests (do not delete in TRUNCATE).
- [ ] Logout/expiration tested with `storageState: undefined`, not touching the global file.
- [ ] Constants `STORAGE_STATE_PATH` etc. imported from `./setup/seed-state.ts`, not hardcoded.
