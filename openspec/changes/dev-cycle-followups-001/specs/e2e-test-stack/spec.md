## ADDED Requirements

### Requirement: Reusable mock GoTrue helper at `lib/test-utils/mock-gotrue.ts`

The system SHALL expose a reusable, in-process mock GoTrue server as a module at
`lib/test-utils/mock-gotrue.ts`. The module MUST export a function `startMockGotrue` (or an
equivalent named export) whose return value, after awaiting, exposes at minimum:

- `port: number` — the port the mock GoTrue is listening on. The implementation MUST default
  to `54321` (the same port a local `supabase start` exposes) so that one Next.js build
  artifact, with `NEXT_PUBLIC_SUPABASE_URL` inlined at build time, can serve both the
  default e2e suite (mock GoTrue) and the `@auth-real` suite (real Supabase) without
  rebuilding.
- `stop(): Promise<void>` — a function that releases the listening socket. After `stop()`
  resolves, the same port MUST be re-bindable.
- `jwt: string` — a valid JWT that the mock will accept on `/auth/v1/user` requests. The
  same JWT MUST be acceptable to a Supabase server-side client created with the mock's
  configuration so that `supabase.auth.getUser()` returns a non-null user.

The mock MUST respond to at least the endpoints `supabase-js` touches during a server-side
`getUser()` flow (`/auth/v1/user`, `/auth/v1/token`) and SHOULD be small enough that future
e2e suites can reach for it without copy-paste.

The existing wrapper `e2e/start-server.ts` MUST import the helper from
`lib/test-utils/mock-gotrue.ts` (the previous `e2e/mock-gotrue.ts` location is removed).

#### Scenario: `startMockGotrue` returns a valid handle

- **WHEN** a test calls `await startMockGotrue()`
- **THEN** the returned object exposes a numeric `port`, a `stop` async function, and a
  `jwt` string with a valid three-segment JWT shape

#### Scenario: `stop()` releases the listening socket

- **WHEN** a test calls `startMockGotrue()` and later awaits the returned `stop()`
- **THEN** a subsequent call to `startMockGotrue()` on the same port succeeds without an
  `EADDRINUSE` error

#### Scenario: `getUser()` succeeds against the mock

- **WHEN** a Supabase server-side client is configured against the mock's URL with the
  helper's `jwt` set as the access token cookie
- **THEN** `supabase.auth.getUser()` returns a user object (not `null`) and does not throw

#### Scenario: e2e auth suite uses the relocated helper

- **WHEN** `npm run test:e2e -- --grep @auth` runs after this change merges
- **THEN** the suite starts (driven by `e2e/start-server.ts` importing the helper from
  `lib/test-utils/mock-gotrue.ts`) and the existing `@auth` cases pass without a
  copy-pasted local mock under `e2e/`
