// Tiny mock GoTrue used by the default e2e suite (`@auth`) so the dashboard
// page and root middleware can call `supabase.auth.getUser()` without a real
// Supabase Auth server.
//
// Why this exists: the default e2e suite is Postgres-only (Testcontainers).
// `getUser()` always makes a network call to `<SUPABASE_URL>/auth/v1/user`
// to validate the JWT — a simulated cookie alone is not enough. This mock
// validates the bearer against a fixed token written by `auth.setup.ts` and
// returns the seeded user when it matches, so the rest of the auth surface
// (cookie refresh, `signOut`) round-trips without errors.
//
// Surface intentionally minimal:
//   • `GET    /auth/v1/user`   — bearer match → seeded user JSON; else 401.
//   • `POST   /auth/v1/logout` — always 204 (signOut should succeed even on
//     the mock so the UX path is identical to production).
//   • `GET    /auth/v1/settings` — returns the small JSON the SDK fetches on
//     init in some configurations; harmless 200 keeps the SDK quiet.
//
// Anything else returns 404 so a missing handler is loud, not silent.
//
// Public surface (Decision 2 of dev-cycle-followups-001):
//   `startMockGotrue(options?)` resolves to `{ port, stop, jwt, url }`. The
//   `jwt` is built once at start time using a default-good payload so the
//   80% caller does not also need to import `buildFixedJwt`. Callers that
//   need to mint additional/custom tokens can still import `buildFixedJwt`.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockGoTrueUser = {
  id: string;
  aud: string;
  role: string;
  email: string;
  email_confirmed_at: string;
  phone: string;
  confirmed_at: string;
  last_sign_in_at: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  created_at: string;
  updated_at: string;
};

export type MockGoTrueHandle = {
  // The port the mock is listening on. Preferred over `url` for callers
  // that need to compose URLs differently (e.g., env validation expects a
  // full URL string, but a sibling helper might want the raw port).
  port: number;
  // Tear down the entire mock and release the listening socket. After this
  // resolves, the same port is re-bindable.
  stop: () => Promise<void>;
  // A valid JWT the mock will accept on `/auth/v1/user`. Built once at
  // start time so consumers do not need to also call `buildFixedJwt`.
  jwt: string;
  // Convenience: full origin string `http://127.0.0.1:<port>`. Equivalent
  // to `\`http://127.0.0.1:${handle.port}\`` — kept here so call sites can
  // pass it straight to `createServerClient` / `NEXT_PUBLIC_SUPABASE_URL`.
  url: string;
};

export type MockGoTrueOptions = {
  // The bearer token value that authorises the seeded user. Any other token
  // (or no token) yields 401, matching the real GoTrue behaviour. If
  // omitted, a long-lived JWT is minted from the (defaulted) `user` and
  // exposed on the handle as `jwt`.
  fixedToken?: string;
  // The user payload returned by `GET /auth/v1/user`. Built from the same
  // seed row inserted by `globalSetup` so the dashboard greeting matches the
  // value asserted in `auth.spec.ts`. Defaults to a stable seeded user when
  // omitted (matching the identity used by `e2e/start-server.ts`).
  user?: MockGoTrueUser;
  // Port to bind to. We use a fixed port (rather than `0` for ephemeral)
  // because Next.js inlines `NEXT_PUBLIC_SUPABASE_URL` into the EDGE bundle
  // at build time — middleware code that calls `supabase.auth.getUser()`
  // would otherwise hit the build-time placeholder URL, not the dynamic
  // mock URL. By binding the mock to the same port as the placeholder,
  // both the (Node) server runtime AND the edge runtime reach the right
  // server without rebuilding for every run.
  //
  // Defaults to `54321` (the same port a local `supabase start` exposes
  // and the value `src/shared/env/client.ts` validates for in CI builds).
  port?: number;
};

// Defaults wired in when the caller does not supply overrides. Picking a
// stable UUID (rather than `randomUUID()`) keeps assertions deterministic
// across runs and lets reused infrastructure skip re-seeding identical rows.
const DEFAULT_PORT = 54321;
const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_EMAIL = 'seed@example.com';

export async function startMockGotrue(options: MockGoTrueOptions = {}): Promise<MockGoTrueHandle> {
  const port = options.port ?? DEFAULT_PORT;
  const user = options.user ?? buildDefaultUser();
  // Mint a long-lived JWT whose payload matches the (defaulted) user. `exp`
  // is set far in the future so `setSession` does not detour through
  // `_callRefreshToken`. Reused verbatim if the caller passed `fixedToken`.
  const jwt = options.fixedToken ?? buildDefaultJwt(user);

  const server = createServer((req, res) => handleRequest(req, res, { fixedToken: jwt, user }));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('mock-gotrue: failed to bind to the requested port');
  }

  const { port: boundPort }: AddressInfo = address;
  const url = `http://127.0.0.1:${boundPort}`;

  return {
    port: boundPort,
    stop: () => closeServer(server),
    jwt,
    url,
  };
}

type ResolvedRequestContext = {
  fixedToken: string;
  user: MockGoTrueUser;
};

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: ResolvedRequestContext,
): void {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const path = rawUrl.split('?')[0] ?? '/';

  // GoTrue's `/user` endpoint is what `supabase.auth.getUser(jwt)` calls. The
  // SDK passes the access token both via the `Authorization: Bearer …`
  // header and as the JSON body. We only inspect the header — that's what
  // the real GoTrue gates on, and it keeps the mock body-parser-free.
  if (method === 'GET' && path === '/auth/v1/user') {
    const header = req.headers.authorization ?? '';
    const expected = `Bearer ${context.fixedToken}`;
    if (header === expected) {
      respondJson(res, 200, context.user);
      return;
    }
    respondJson(res, 401, { code: 401, msg: 'invalid token' });
    return;
  }

  // signOut must succeed cleanly. Real GoTrue returns 204 No Content here.
  if (method === 'POST' && path === '/auth/v1/logout') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Some SDK init paths fetch settings. Returning a benign 200 avoids
  // spurious warnings without us having to handcraft a realistic payload —
  // the auth flows we exercise don't depend on the values.
  if (method === 'GET' && path === '/auth/v1/settings') {
    respondJson(res, 200, { external: {}, disable_signup: true, mailer_autoconfirm: true });
    return;
  }

  // PostgREST shim for `/rest/v1/profiles`. The Edge-runtime middleware
  // calls `supabase.from('profiles').select(...).eq('user_id', X)
  // .maybeSingle()` to resolve the active profile (Node-only Drizzle
  // can't run on Edge). We answer with a static `active` profile for the
  // seeded user so the dashboard surface stays reachable. Any other
  // `user_id` filter returns an empty array (treated as `null` by
  // `.maybeSingle()`), which middleware maps to "no profile" and
  // redirects to /login.
  //
  // We don't try to fully emulate PostgREST's filter grammar — the
  // middleware only ever issues an `eq.<uuid>` filter on `user_id`, so
  // the regex below is sufficient. Add more filters here if a future
  // call site needs them.
  if (method === 'GET' && path === '/rest/v1/profiles') {
    const queryString = rawUrl.includes('?') ? (rawUrl.split('?')[1] ?? '') : '';
    const params = new URLSearchParams(queryString);
    const userIdFilter = params.get('user_id') ?? '';
    const match = /^eq\.(.+)$/.exec(userIdFilter);
    const requestedUserId = match?.[1];

    // `.maybeSingle()` sends `Accept: application/vnd.pgrst.object+json`,
    // so PostgREST replies with a single JSON object on match (200) or
    // an empty `{}` payload at 406 on no-match. We replicate both
    // behaviours so supabase-js parses the response identically to a
    // real Postgres+PostgREST stack.
    const acceptsObject = (req.headers.accept ?? '').includes('application/vnd.pgrst.object+json');
    if (requestedUserId === context.user.id) {
      const row = buildSeededProfileRow(context.user);
      respondJson(res, 200, acceptsObject ? row : [row]);
      return;
    }
    if (acceptsObject) {
      respondJson(res, 406, {
        code: 'PGRST116',
        details: 'Results contain 0 rows',
        message: 'JSON object requested, multiple (or no) rows returned',
      });
      return;
    }
    respondJson(res, 200, []);
    return;
  }

  respondJson(res, 404, { code: 404, msg: 'mock-gotrue: route not found', method, path });
}

// Static profile row for the seeded user. Returned by the PostgREST shim
// above so the Edge-runtime middleware can resolve the seeded user as
// `active` without standing up Postgres-as-PostgREST in the e2e stack.
// Field names mirror the snake-cased columns the middleware reads via
// `.from('profiles').select(...)`.
function buildSeededProfileRow(user: MockGoTrueUser): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    user_id: user.id,
    email: user.email,
    full_name: 'Seed User',
    crp_number: '00000-S',
    crp_uf: 'SP',
    crp_validated_at: now,
    crp_validated_by: null,
    email_verified_at: now,
    status: 'active',
    terms_accepted_at: now,
    privacy_accepted_at: now,
    sensitive_data_consent_at: now,
    created_at: now,
    updated_at: now,
  };
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function buildDefaultUser(): MockGoTrueUser {
  const nowIso = new Date().toISOString();
  return {
    id: DEFAULT_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: DEFAULT_EMAIL,
    email_confirmed_at: nowIso,
    phone: '',
    confirmed_at: nowIso,
    last_sign_in_at: nowIso,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function buildDefaultJwt(user: MockGoTrueUser): string {
  const nowSec = Math.floor(Date.now() / 1000);
  return buildFixedJwt({
    sub: user.id,
    email: user.email,
    aud: user.aud,
    role: user.role,
    // 30 days out — long enough to outlast any test run without going
    // through `_callRefreshToken`, short enough to be obviously bogus.
    exp: nowSec + 60 * 60 * 24 * 30,
    iat: nowSec,
  });
}

// Minimal helper: encode a JSON object as a base64url string suitable for the
// `payload` segment of a JWT. Used by `auth.setup.ts` to build the fixed
// token. Kept here so the format lives next to the mock that consumes it.
export function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function buildFixedJwt(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  // The mock does not verify signatures — any non-empty third segment makes
  // the token syntactically valid for `decodeJWT()` consumers in supabase-js.
  const signature = 'mock-signature';
  return `${header}.${body}.${signature}`;
}
