// Tiny mock GoTrue used by the default e2e suite (`@auth`) so the dashboard
// page and root middleware can call `supabase.auth.getUser()` without a real
// Supabase Auth server.
//
// Why this exists: the default e2e suite is Postgres-only (Testcontainers).
// `getUser()` always makes a network call to `<SUPABASE_URL>/auth/v1/user`
// to validate the JWT — a simulated cookie alone is not enough. This mock
// validates the bearer against a registry of known tokens (seeded with the
// fixed token written by `auth.setup.ts` plus any tokens minted by the
// signup/signin endpoints below) and returns the seeded user when it matches,
// so the rest of the auth surface (cookie refresh, `signOut`) round-trips
// without errors.
//
// Surface the mock provides:
//   • `GET    /auth/v1/user`                     — bearer match → registered user JSON; else 401.
//   • `POST   /auth/v1/logout`                   — always 204.
//   • `GET    /auth/v1/settings`                 — small JSON the SDK fetches on init.
//   • `POST   /auth/v1/signup`                   — synthesize a user, register a token, return `{ user, session: null }` (email-confirmation flow).
//   • `POST   /auth/v1/token?grant_type=password`— look up email/password, mint tokens, return a session.
//   • `DELETE /auth/v1/admin/users/:id`          — compensating delete on signup rollback.
//
// Anything else returns 404 so a missing handler is loud, not silent.
//
// Public surface:
//   `startMockGotrue(options?)` resolves to `{ port, stop, jwt, url, registry }`.
//   The `jwt` is built once at start time using a default-good payload so the
//   80% caller does not also need to import `buildFixedJwt`. Callers that
//   need to mint additional/custom tokens can still import `buildFixedJwt`.
//   The `registry` exposes a small set of helpers for seeded e2e specs to
//   register known users (so the dashboard render path can resolve the
//   identity behind a programmatically-issued JWT).
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import postgres from 'postgres';

export type MockGoTrueUser = {
  id: string;
  aud: string;
  role: string;
  email: string;
  email_confirmed_at: string | null;
  phone: string;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  created_at: string;
  updated_at: string;
};

// Registry contract exposed to seeded e2e specs. The e2e setup boots the mock
// once for the whole suite, then specs can register additional users (as part
// of their `beforeAll`/`beforeEach`) so that programmatically-issued sessions
// resolve to the right identity at `GET /auth/v1/user`.
export type MockGoTrueRegistry = {
  // Register a token → user mapping. Subsequent `GET /auth/v1/user` calls
  // bearing this token answer with the supplied user payload. Idempotent —
  // calling with the same token replaces the previous mapping.
  registerToken(token: string, user: MockGoTrueUser): void;
  // Remove a token from the registry. Used by `signOut`-style helpers in
  // tests that want to assert the bearer no longer authenticates.
  revokeToken(token: string): void;
  // Register an email/password pair → user mapping for the `password` grant
  // (signin) path. The signup path also calls this internally so subsequent
  // signins with the same credentials work.
  registerCredentials(email: string, password: string, user: MockGoTrueUser): void;
  // Remove a user entirely (token map + credential map). Used by the
  // compensating-delete admin endpoint and by tests that want a clean slate.
  removeUser(userId: string): void;
};

export type MockGoTrueHandle = {
  port: number;
  stop: () => Promise<void>;
  jwt: string;
  url: string;
  registry: MockGoTrueRegistry;
};

export type MockGoTrueOptions = {
  fixedToken?: string;
  user?: MockGoTrueUser;
  port?: number;
  // Connection string for the test Postgres. When provided, the mock
  // mirrors `signup` and `admin/users DELETE` operations into the test
  // container's `auth.users` table so the FK from
  // `psychologist_profiles.user_id` resolves. Production GoTrue and the
  // real database share a single Postgres, so this mirrors that contract
  // for the seeded e2e suite. When omitted, the mock skips the DB write
  // entirely (used by the unit test suite for the mock itself).
  databaseUrl?: string;
};

const DEFAULT_PORT = 54321;
const DEFAULT_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_EMAIL = 'seed@example.com';

// Internal state buckets. Module-private — only the registry handle exposes
// safe mutation entry points. The mock server itself reads from these via
// closure capture.
type State = {
  // Token → user. The seed token is registered at boot.
  tokens: Map<string, MockGoTrueUser>;
  // Email → { password, user }. Populated by `signup` and `registerCredentials`.
  credentials: Map<string, { password: string; user: MockGoTrueUser }>;
  // userId → token (last-issued). Lets `removeUser` flush the corresponding
  // token entry without scanning the whole token map.
  userTokens: Map<string, string>;
  // Optional postgres-js client used to mirror signup/admin-delete into the
  // test database's `auth.users` stub. `null` when the caller did not pass
  // `databaseUrl`. Closed at server shutdown.
  db: postgres.Sql | null;
};

export async function startMockGotrue(options: MockGoTrueOptions = {}): Promise<MockGoTrueHandle> {
  const port = options.port ?? DEFAULT_PORT;
  const seedUser = options.user ?? buildDefaultUser();
  const seedToken = options.fixedToken ?? buildDefaultJwt(seedUser);

  const state: State = {
    tokens: new Map<string, MockGoTrueUser>(),
    credentials: new Map<string, { password: string; user: MockGoTrueUser }>(),
    userTokens: new Map<string, string>(),
    db: options.databaseUrl ? postgres(options.databaseUrl, { max: 1, onnotice: () => {} }) : null,
  };
  state.tokens.set(seedToken, seedUser);
  state.userTokens.set(seedUser.id, seedToken);

  const server = createServer((req, res) => {
    handleRequest(req, res, state).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown';
      respondJson(res, 500, { code: 500, msg: `mock-gotrue: handler threw: ${message}` });
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

  const registry: MockGoTrueRegistry = {
    registerToken(token, user) {
      state.tokens.set(token, user);
      state.userTokens.set(user.id, token);
    },
    revokeToken(token) {
      const user = state.tokens.get(token);
      state.tokens.delete(token);
      if (user) state.userTokens.delete(user.id);
    },
    registerCredentials(email, password, user) {
      state.credentials.set(email.toLowerCase(), { password, user });
    },
    removeUser(userId) {
      const token = state.userTokens.get(userId);
      if (token) state.tokens.delete(token);
      state.userTokens.delete(userId);
      // Walk credentials to remove every email mapped to this user. There
      // is at most one in practice (signup is one-email-per-user), but the
      // walk is defensive in case a test registers multiple aliases.
      for (const [email, entry] of state.credentials) {
        if (entry.user.id === userId) {
          state.credentials.delete(email);
        }
      }
    },
  };

  return {
    port: boundPort,
    stop: async () => {
      await closeServer(server);
      if (state.db) {
        await state.db.end({ timeout: 5 });
      }
    },
    jwt: seedToken,
    url,
    registry,
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  state: State,
): Promise<void> {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const [pathOnly = '/', queryString = ''] = rawUrl.split('?', 2);
  const path = pathOnly;
  const query = new URLSearchParams(queryString);

  // GET /auth/v1/user — bearer match against the token registry.
  if (method === 'GET' && path === '/auth/v1/user') {
    const header = req.headers.authorization ?? '';
    const token = extractBearer(header);
    if (token && state.tokens.has(token)) {
      respondJson(res, 200, state.tokens.get(token));
      return;
    }
    respondJson(res, 401, { code: 401, msg: 'invalid token' });
    return;
  }

  // POST /auth/v1/logout — always 204. Real GoTrue is the same.
  if (method === 'POST' && path === '/auth/v1/logout') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // GET /auth/v1/settings — benign 200.
  if (method === 'GET' && path === '/auth/v1/settings') {
    respondJson(res, 200, { external: {}, disable_signup: false, mailer_autoconfirm: false });
    return;
  }

  // POST /auth/v1/signup — synthesize a user and register the token. Returns
  // `{ user, session: null }` to mirror the email-confirmation flow (the
  // user must click the verification link before they can sign in).
  //
  // The `signUpImpl` Server Action only consumes `signUpData.user.id` from
  // the response; it does not establish a session here.
  if (method === 'POST' && path === '/auth/v1/signup') {
    const body = await readJsonBody(req);
    const email = typeof body?.email === 'string' ? body.email : null;
    const password = typeof body?.password === 'string' ? body.password : null;
    if (!email || !password) {
      respondJson(res, 400, {
        code: 400,
        msg: 'mock-gotrue: signup requires email and password',
      });
      return;
    }
    const lower = email.toLowerCase();
    if (state.credentials.has(lower)) {
      // Mirror the real GoTrue's "user already registered" surface so the
      // signup action's error mapping (`message.includes('already registered')`)
      // catches the duplicate and surfaces `email_already_registered`.
      respondJson(res, 422, {
        code: 422,
        error_code: 'email_address_already_registered',
        msg: 'User already registered',
      });
      return;
    }
    const userId = randomUUID();
    const user = buildUser({ id: userId, email });
    state.credentials.set(lower, { password, user });
    // Don't issue an access token at signup — the email-confirmation flow
    // requires the user to verify their email before any session exists.
    // The `auth.users.email_confirmed_at` is null until the callback runs.
    user.email_confirmed_at = null;
    user.confirmed_at = null;
    user.last_sign_in_at = null;
    // Mirror the user into the test container's `auth.users` stub so the
    // FK from `psychologist_profiles.user_id` resolves on the post-signup
    // INSERT issued by the Server Action. Real Supabase runs GoTrue and
    // the application database in the same Postgres; this mirror keeps
    // that contract for the seeded e2e suite.
    if (state.db) {
      try {
        await state.db`
          INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${userId}, ${email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING
        `;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        respondJson(res, 500, {
          code: 500,
          msg: `mock-gotrue: failed to mirror auth.users insert: ${msg}`,
        });
        return;
      }
    }
    respondJson(res, 200, { user, session: null });
    return;
  }

  // POST /auth/v1/token?grant_type=password — sign in. Look up email/password
  // in the credential registry, mint an access + refresh token, register them,
  // and return a session payload that supabase-js's `_sessionResponse` can
  // unpack.
  if (method === 'POST' && path === '/auth/v1/token' && query.get('grant_type') === 'password') {
    const body = await readJsonBody(req);
    const email = typeof body?.email === 'string' ? body.email : null;
    const password = typeof body?.password === 'string' ? body.password : null;
    if (!email || !password) {
      respondJson(res, 400, {
        code: 400,
        error_code: 'validation_failed',
        msg: 'mock-gotrue: password grant requires email and password',
      });
      return;
    }
    const entry = state.credentials.get(email.toLowerCase());
    if (!entry || entry.password !== password) {
      respondJson(res, 400, {
        code: 400,
        error_code: 'invalid_credentials',
        msg: 'Invalid login credentials',
      });
      return;
    }
    // Mark the user as email-confirmed at signin time only if the test
    // already drove the verification step (the signup endpoint deliberately
    // sets `email_confirmed_at = null`). Tests that need to bypass
    // verification register the user via `registerCredentials` with an
    // already-confirmed user payload.
    const accessToken = buildDefaultJwt(entry.user);
    const refreshToken = `mock-refresh-${entry.user.id}`;
    state.tokens.set(accessToken, entry.user);
    state.userTokens.set(entry.user.id, accessToken);
    const nowSec = Math.floor(Date.now() / 1000);
    respondJson(res, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 60 * 60 * 24 * 30,
      expires_at: nowSec + 60 * 60 * 24 * 30,
      token_type: 'bearer',
      user: entry.user,
    });
    return;
  }

  // POST /__test/register-credentials — TEST-ONLY sidecar endpoint. Lets a
  // Playwright spec (running in a different process from the mock) seed an
  // email/password/user mapping into the mock's credential registry, so a
  // subsequent signin call from inside the webServer process can resolve it.
  //
  // The endpoint is gated on the request origin: it only responds when the
  // socket peer is localhost (127.0.0.1 / ::1). The mock binds to 127.0.0.1
  // anyway, so this is a belt-and-braces guard against accidental exposure
  // if the bind address ever changes. The endpoint name is namespaced under
  // `/__test/` to make it obvious in logs that this is not a real GoTrue
  // route.
  if (method === 'POST' && path === '/__test/register-credentials') {
    if (!isLocalhostRequest(req)) {
      respondJson(res, 403, { code: 403, msg: 'mock-gotrue: __test endpoints are localhost-only' });
      return;
    }
    const body = await readJsonBody(req);
    const email = typeof body?.email === 'string' ? body.email : null;
    const password = typeof body?.password === 'string' ? body.password : null;
    const userId = typeof body?.userId === 'string' ? body.userId : null;
    const emailConfirmed = body?.emailConfirmed !== false; // default true
    if (!email || !password || !userId) {
      respondJson(res, 400, {
        code: 400,
        msg: 'mock-gotrue: register-credentials requires email, password, and userId',
      });
      return;
    }
    const user = buildUser({ id: userId, email, emailConfirmed });
    state.credentials.set(email.toLowerCase(), { password, user });
    respondJson(res, 200, { ok: true, userId });
    return;
  }

  // POST /__test/remove-user — TEST-ONLY teardown helper. Removes a user
  // from the mock's registries by user id. Idempotent.
  if (method === 'POST' && path === '/__test/remove-user') {
    if (!isLocalhostRequest(req)) {
      respondJson(res, 403, { code: 403, msg: 'mock-gotrue: __test endpoints are localhost-only' });
      return;
    }
    const body = await readJsonBody(req);
    const userId = typeof body?.userId === 'string' ? body.userId : null;
    if (!userId) {
      respondJson(res, 400, { code: 400, msg: 'mock-gotrue: remove-user requires userId' });
      return;
    }
    const token = state.userTokens.get(userId);
    if (token) state.tokens.delete(token);
    state.userTokens.delete(userId);
    for (const [email, entry] of state.credentials) {
      if (entry.user.id === userId) state.credentials.delete(email);
    }
    respondJson(res, 200, { ok: true });
    return;
  }

  // DELETE /auth/v1/admin/users/:id — compensating delete on signup rollback.
  // The `signUpImpl` action calls this through the admin client when the
  // post-signup transaction fails (UNIQUE collision on CRP, etc.).
  if (method === 'DELETE' && path.startsWith('/auth/v1/admin/users/')) {
    const userId = path.slice('/auth/v1/admin/users/'.length);
    if (!userId) {
      respondJson(res, 400, { code: 400, msg: 'mock-gotrue: admin delete requires user id' });
      return;
    }
    // Drain the request body — the SDK sends `{ should_soft_delete }` in the
    // body and node will keep the connection open until we consume it.
    await readJsonBody(req);
    // Real GoTrue returns 200 with an empty body when the user is removed,
    // and 200 even if the user did not exist (the SDK does not expose that
    // distinction in any meaningful way). We mirror that.
    state.tokens.forEach((user, token) => {
      if (user.id === userId) state.tokens.delete(token);
    });
    state.userTokens.delete(userId);
    for (const [email, entry] of state.credentials) {
      if (entry.user.id === userId) state.credentials.delete(email);
    }
    // Mirror into the test database: real GoTrue's admin delete cascades
    // through `auth.users`. We do the same so the post-rollback row count
    // assertions in the duplicate-* specs see the orphan disappear.
    if (state.db) {
      try {
        await state.db`DELETE FROM auth.users WHERE id = ${userId}`;
      } catch {
        // Best-effort: a rollback that races with the FK delete is still a
        // valid mock outcome; the test asserts on row counts, which are
        // satisfied either way.
      }
    }
    respondJson(res, 200, {});
    return;
  }

  respondJson(res, 404, { code: 404, msg: 'mock-gotrue: route not found', method, path });
}

function extractBearer(header: string): string | null {
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

// True when the inbound request originates from the loopback interface. Used
// to gate the `/__test/...` sidecar endpoints. The mock binds to 127.0.0.1
// already, so any non-loopback peer would have to come from a misconfigured
// reverse proxy — refuse them defensively.
function isLocalhostRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
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

// Build a default seed user payload. Stable id and timestamp so reused
// containers / runs keep the same identity.
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

// Build a user payload for an arbitrary email/userId. Used by `signup` to
// synthesize a fresh row in the credentials registry. Email confirmed-at is
// initialized to "now" but the signup handler clears it to null to mirror
// the email-confirmation flow.
export function buildUser({
  id,
  email,
  emailConfirmed,
}: {
  id?: string;
  email: string;
  emailConfirmed?: boolean;
}): MockGoTrueUser {
  const nowIso = new Date().toISOString();
  const confirmed = emailConfirmed ?? true;
  return {
    id: id ?? randomUUID(),
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: confirmed ? nowIso : null,
    phone: '',
    confirmed_at: confirmed ? nowIso : null,
    last_sign_in_at: confirmed ? nowIso : null,
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
