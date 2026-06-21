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
import { createHmac } from 'node:crypto';
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
  // Fixed password for the seeded user. When set, `POST /auth/v1/token`
  // validates the password against this value. When omitted, any password
  // is accepted for the seeded user's email (backward-compatible).
  fixedPassword?: string;
};

// ---------------------------------------------------------------------------
// Dynamic OAuth user registry
//
// E2E tests register additional users via `POST /_test/register-oauth-user`
// and clear them via `POST /_test/clear-oauth-users`. Registered users are
// available for PKCE code exchange, bearer-authenticated GET /auth/v1/user,
// and GET /rest/v1/profiles lookups.
// ---------------------------------------------------------------------------
export type RegisteredOAuthUser = {
  user: MockGoTrueUser;
  jwt: string;
  code: string;
  /**
   * Optional per-user refresh token. When supplied, `POST /auth/v1/token`
   * with `grant_type=refresh_token` resolves THIS user (and re-issues its
   * `jwt`) — keeping a refreshed session bound to the correct registered user
   * instead of collapsing every registered user to the default seeded identity.
   * Tests that drive a dedicated user through a Server Action (which may trigger
   * a server-side token refresh) MUST set a unique value here, or the refresh
   * would resolve the wrong user.
   */
  refreshToken?: string;
  /** When defined, the mock returns this profile row via the PostgREST shim. */
  profile?: Record<string, unknown> | null;
};

// Module-scoped registry — shared across all requests within the same process.
const oauthUserRegistry = new Map<string, RegisteredOAuthUser>();

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

  const server = createServer((req, res) => {
    handleRequest(req, res, {
      fixedToken: jwt,
      user,
      fixedPassword: options.fixedPassword,
    }).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'internal mock error' }));
      }
    });
  });

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
  fixedPassword?: string;
};

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: ResolvedRequestContext,
): Promise<void> {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const path = rawUrl.split('?')[0] ?? '/';

  // ---- Test-only API: dynamic OAuth user registration ----
  if (method === 'POST' && path === '/_test/register-oauth-user') {
    const body = await readBody(req);
    try {
      const entry = JSON.parse(body) as RegisteredOAuthUser;
      oauthUserRegistry.set(entry.code, entry);
      respondJson(res, 200, { registered: true, code: entry.code });
    } catch {
      respondJson(res, 400, { error: 'invalid JSON' });
    }
    return;
  }
  if (method === 'POST' && path === '/_test/clear-oauth-users') {
    // Scoped clear: when the caller supplies a `{ code }`, remove ONLY that
    // registration. A blanket `oauthUserRegistry.clear()` here is a cross-spec
    // hazard under `fullyParallel` — it wipes the dedicated checklist/empty
    // users registered by `signInAsDedicatedUser` while their specs are still
    // running, so the Edge profile shim resolves "no profile" mid-test and the
    // middleware bounces them to /login. Callers that own a single registration
    // (the Google-OAuth stub teardown) MUST pass their own `code` so cleanup is
    // surgical; the unscoped full-clear is kept only for explicit global resets.
    const body = await readBody(req);
    let scopedCode: string | undefined;
    if (body.trim().length > 0) {
      try {
        scopedCode = (JSON.parse(body) as { code?: string }).code;
      } catch {
        respondJson(res, 400, { error: 'invalid JSON' });
        return;
      }
    }
    if (scopedCode !== undefined) {
      oauthUserRegistry.delete(scopedCode);
      respondJson(res, 200, { cleared: true, code: scopedCode });
      return;
    }
    oauthUserRegistry.clear();
    respondJson(res, 200, { cleared: true });
    return;
  }

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
    // Check registered OAuth users.
    for (const entry of oauthUserRegistry.values()) {
      if (header === `Bearer ${entry.jwt}`) {
        respondJson(res, 200, entry.user);
        return;
      }
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

    // Check registered OAuth users for profile data.
    for (const entry of oauthUserRegistry.values()) {
      if (requestedUserId === entry.user.id && entry.profile !== undefined) {
        if (entry.profile !== null) {
          respondJson(res, 200, acceptsObject ? entry.profile : [entry.profile]);
          return;
        }
        // profile is explicitly null — no profile for this user.
        break;
      }
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

  // OAuth authorize endpoint — `signInWithOAuth` redirects the browser here
  // before going to the external provider. In the mock, we redirect straight
  // to `/auth/callback?code=<first-registered-code>` or to Google (which the
  // E2E stub intercepts at the browser level).
  if (method === 'GET' && path === '/auth/v1/authorize') {
    const queryString = rawUrl.includes('?') ? (rawUrl.split('?')[1] ?? '') : '';
    const params = new URLSearchParams(queryString);
    const redirectTo = params.get('redirect_to') ?? '';

    // If there's a registered OAuth user, redirect to the callback with
    // their code. This simulates the full Google consent flow.
    if (oauthUserRegistry.size > 0) {
      const firstEntry = oauthUserRegistry.values().next().value;
      if (firstEntry) {
        const callbackUrl = new URL(redirectTo || 'http://localhost:3000/auth/callback');
        callbackUrl.searchParams.set('code', firstEntry.code);
        res.statusCode = 302;
        res.setHeader('Location', callbackUrl.toString());
        res.end();
        return;
      }
    }

    // No registered OAuth users — redirect to Google (the browser-level
    // stub will intercept). In a real environment this would go to Google.
    res.statusCode = 302;
    res.setHeader(
      'Location',
      `https://accounts.google.com/o/oauth2/auth?redirect_uri=${encodeURIComponent(redirectTo)}`,
    );
    res.end();
    return;
  }

  // Admin API: GET /auth/v1/admin/users/:id — getUserById.
  if (method === 'GET' && path.startsWith('/auth/v1/admin/users/')) {
    const userId = path.split('/').pop() ?? '';
    for (const entry of oauthUserRegistry.values()) {
      if (entry.user.id === userId) {
        respondJson(res, 200, entry.user);
        return;
      }
    }
    if (userId === context.user.id) {
      respondJson(res, 200, context.user);
      return;
    }
    respondJson(res, 404, { code: 404, msg: 'User not found' });
    return;
  }

  // Admin API: DELETE /auth/v1/admin/users/:id — deleteUser.
  if (method === 'DELETE' && path.startsWith('/auth/v1/admin/users/')) {
    const userId = path.split('/').pop() ?? '';
    // Remove from registry if present.
    for (const [code, entry] of oauthUserRegistry.entries()) {
      if (entry.user.id === userId) {
        oauthUserRegistry.delete(code);
        break;
      }
    }
    respondJson(res, 200, { id: userId });
    return;
  }

  // `POST /auth/v1/token` handles multiple grant types:
  //   - `grant_type=password` — signInWithPassword
  //   - `grant_type=pkce` — exchangeCodeForSession (OAuth PKCE flow)
  if (method === 'POST' && path === '/auth/v1/token') {
    const queryString = rawUrl.includes('?') ? (rawUrl.split('?')[1] ?? '') : '';
    const queryParams = new URLSearchParams(queryString);
    const grantType = queryParams.get('grant_type');

    const body = await readBody(req);

    // PKCE code exchange — used by OAuth callback.
    if (grantType === 'pkce') {
      let parsed: { auth_code?: string; code_verifier?: string } = {};
      try {
        parsed = JSON.parse(body) as { auth_code?: string; code_verifier?: string };
      } catch {
        respondJson(res, 400, {
          error: 'invalid_grant',
          error_description: 'Invalid request body',
        });
        return;
      }

      const code = parsed.auth_code ?? '';
      const entry = oauthUserRegistry.get(code);
      if (entry) {
        const nowIso = new Date().toISOString();
        const nowSec = Math.floor(Date.now() / 1000);
        respondJson(res, 200, {
          access_token: entry.jwt,
          token_type: 'bearer',
          expires_in: 60 * 60 * 24 * 30,
          expires_at: nowSec + 60 * 60 * 24 * 30,
          refresh_token: 'mock-refresh-token',
          user: {
            ...entry.user,
            last_sign_in_at: nowIso,
          },
        });
        return;
      }

      // Fall through to default seeded user for recovery codes, etc.
      const nowIso = new Date().toISOString();
      const nowSec = Math.floor(Date.now() / 1000);
      respondJson(res, 200, {
        access_token: context.fixedToken,
        token_type: 'bearer',
        expires_in: 60 * 60 * 24 * 30,
        expires_at: nowSec + 60 * 60 * 24 * 30,
        refresh_token: 'mock-refresh-token',
        user: {
          ...context.user,
          last_sign_in_at: nowIso,
        },
      });
      return;
    }

    // Refresh-token grant — supabase-js calls this server-side when it deems the
    // access token near expiry (e.g. during a Server Action's `getUser()`). We
    // resolve the user by the supplied refresh token so a refreshed session
    // stays bound to the right identity. A registered dedicated user with a
    // UNIQUE refresh token resolves to itself; anything else (including the
    // shared `mock-refresh-token`) re-issues the default seeded session, which
    // is the historical behaviour the rest of the suite relies on.
    if (grantType === 'refresh_token') {
      let parsedRefresh: { refresh_token?: string } = {};
      try {
        parsedRefresh = JSON.parse(body) as { refresh_token?: string };
      } catch {
        parsedRefresh = {};
      }
      const suppliedRefresh = parsedRefresh.refresh_token ?? queryParams.get('refresh_token') ?? '';

      const nowIso = new Date().toISOString();
      const nowSec = Math.floor(Date.now() / 1000);

      for (const entry of oauthUserRegistry.values()) {
        if (entry.refreshToken && entry.refreshToken === suppliedRefresh) {
          respondJson(res, 200, {
            access_token: entry.jwt,
            token_type: 'bearer',
            expires_in: 60 * 60 * 24 * 30,
            expires_at: nowSec + 60 * 60 * 24 * 30,
            refresh_token: entry.refreshToken,
            user: { ...entry.user, last_sign_in_at: nowIso },
          });
          return;
        }
      }

      respondJson(res, 200, {
        access_token: context.fixedToken,
        token_type: 'bearer',
        expires_in: 60 * 60 * 24 * 30,
        expires_at: nowSec + 60 * 60 * 24 * 30,
        refresh_token: 'mock-refresh-token',
        user: { ...context.user, last_sign_in_at: nowIso },
      });
      return;
    }

    // Password-based login (grant_type=password or no grant_type).
    let parsed: { email?: string; password?: string } = {};
    try {
      parsed = JSON.parse(body) as { email?: string; password?: string };
    } catch {
      respondJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid request body' });
      return;
    }

    // Check registered OAuth users for password verification (used by
    // link-account flow's isolated client).
    for (const entry of oauthUserRegistry.values()) {
      if (parsed.email === entry.user.email) {
        // For registered OAuth users, password is always invalid (they
        // don't have one — they only have Google identity). However, if
        // a traditional account with the same email exists, we should
        // let the seeded user handler below handle it.
        break;
      }
    }

    // If a fixedPassword is set, validate both email and password.
    // If no fixedPassword, accept any password for the seeded user email
    // (backward-compatible with the existing E2E suite).
    const passwordOk = context.fixedPassword ? parsed.password === context.fixedPassword : true;

    if (parsed.email === context.user.email && passwordOk) {
      const nowIso = new Date().toISOString();
      const nowSec = Math.floor(Date.now() / 1000);
      respondJson(res, 200, {
        access_token: context.fixedToken,
        token_type: 'bearer',
        expires_in: 60 * 60 * 24 * 30,
        expires_at: nowSec + 60 * 60 * 24 * 30,
        refresh_token: 'mock-refresh-token',
        user: {
          ...context.user,
          last_sign_in_at: nowIso,
        },
      });
      return;
    }

    respondJson(res, 400, {
      error: 'invalid_grant',
      error_description: 'Invalid login credentials',
    });
    return;
  }

  // `POST /auth/v1/recover` is the endpoint `resetPasswordForEmail` calls.
  // The mock always returns 200 — the real GoTrue sends an email with a
  // recovery link, but the mock just acknowledges the request.
  if (method === 'POST' && path === '/auth/v1/recover') {
    respondJson(res, 200, {});
    return;
  }

  // `PUT /auth/v1/user` is the endpoint `updateUser` calls (e.g. password
  // change after a recovery flow). The mock always succeeds when the bearer
  // token matches.
  if (method === 'PUT' && path === '/auth/v1/user') {
    const header = req.headers.authorization ?? '';
    const expected = `Bearer ${context.fixedToken}`;
    if (header === expected) {
      respondJson(res, 200, context.user);
      return;
    }
    // Check registered OAuth users.
    for (const entry of oauthUserRegistry.values()) {
      if (header === `Bearer ${entry.jwt}`) {
        respondJson(res, 200, entry.user);
        return;
      }
    }
    respondJson(res, 401, { code: 401, msg: 'invalid token' });
    return;
  }

  // `POST /auth/v1/token?grant_type=recovery` — called by
  // `exchangeCodeForSession` when the recovery code comes through the
  // PKCE flow (which is what the callback route uses). We return a valid
  // session, same as password-based login.
  // Already handled above by the existing `/auth/v1/token` handler.

  // Supabase Storage shim: accept any request to /storage/v1/* with a mock
  // response. The consent signing flow generates a PDF and uploads it via the
  // service-role client. In the e2e environment there is no real Storage
  // service, so we return minimal success responses to avoid throwing.
  if (path.startsWith('/storage/v1/')) {
    // Consume the request body for POST/PUT
    if (method === 'POST' || method === 'PUT') {
      await readBody(req);
    }

    // createSignedUploadUrl POSTs to /storage/v1/object/upload/sign/<bucket>/<path>.
    // The SDK reads `data.url` (a relative path) and builds a full URL from it.
    // The returned URL must contain a `token` query parameter.
    if (method === 'POST' && path.includes('/object/upload/sign/')) {
      const mockToken = 'mock-upload-signed-token';
      respondJson(res, 200, {
        url: `${path.replace('/storage/v1', '')}?token=${mockToken}`,
      });
      return;
    }

    // createSignedUrl POSTs to /storage/v1/object/sign/<bucket>/<path>.
    // The SDK reads `data.signedURL` (a relative path) and prepends the base URL.
    // We return a mock signedURL that the SDK can compose into a full URL.
    if (method === 'POST' && path.includes('/object/sign/')) {
      const mockToken = 'mock-signed-token';
      respondJson(res, 200, {
        signedURL: `${path.replace('/storage/v1', '')}?token=${mockToken}`,
      });
      return;
    }

    // download() GETs /storage/v1/object/<bucket>/<path>. Return a synthesized
    // valid MP3 buffer for audio files so `confirmAudioUpload`'s magic-number
    // validation passes. Without this, `discoverUploadedObject` gets no data
    // and returns NOT_FOUND.
    if (method === 'GET' && path.match(/^\/storage\/v1\/object\/[^/]+\/.+/)) {
      const objectPath = path.replace(/^\/storage\/v1\/object\//, '').replace(/\?.*$/, '');

      if (/\.(mp3|m4a|wav|webm)(\?.*)?$/.test(objectPath)) {
        const fakeMp3 = buildMinimalMp3(1024);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(fakeMp3);
        return;
      }

      // Unknown object — return 404 so SDK's download returns null data.
      respondJson(res, 404, { error: 'Object not found' });
      return;
    }

    respondJson(res, 200, { Key: path.replace('/storage/v1/object/', '') });
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
    last_resend_at: null,
    created_at: now,
    updated_at: now,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Builds a minimal buffer that passes MP3 magic-number validation.
 * Starts with an ID3v2 tag header followed by an MPEG sync word.
 */
function buildMinimalMp3(size: number): Buffer {
  const buf = Buffer.alloc(size);
  // ID3v2 header
  buf.write('ID3', 0);
  buf[3] = 0x04; // version major
  buf[4] = 0x00; // version minor
  buf[5] = 0x00; // flags
  buf[6] = 0x00; // synchsafe size
  buf[7] = 0x00;
  buf[8] = 0x00;
  buf[9] = 0x00;
  // MPEG sync word at offset 10
  buf[10] = 0xff;
  buf[11] = 0xfb;
  buf[12] = 0x90;
  buf[13] = 0x00;
  return buf;
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

/**
 * Build a JWT with a valid HMAC-SHA256 signature.
 *
 * `@supabase/auth-js` v2.105+ validates the JWT signature locally (using
 * the anon key as the HMAC secret) before calling `/auth/v1/user`. A fake
 * third segment like `'mock-signature'` therefore fails with "signature is
 * invalid". We use Node's `crypto.createHmac` to produce a genuine
 * HS256 signature so `setSession` passes the local validation and reaches
 * the mock GoTrue's `/auth/v1/user` endpoint.
 *
 * @param secret - HMAC signing key. Defaults to `'e2e-anon-key'`, matching
 *   the anon key passed to `createServerClient` in `auth.setup.ts` and to
 *   `start-server.ts`'s `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 */
export function buildFixedJwt(payload: Record<string, unknown>, secret = 'e2e-anon-key'): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}
