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
  url: string;
  close: () => Promise<void>;
};

export type MockGoTrueOptions = {
  // The bearer token value that authorises the seeded user. Any other token
  // (or no token) yields 401, matching the real GoTrue behaviour.
  fixedToken: string;
  // The user payload returned by `GET /auth/v1/user`. Built from the same
  // seed row inserted by `globalSetup` so the dashboard greeting matches the
  // value asserted in `auth.spec.ts`.
  user: MockGoTrueUser;
  // Port to bind to. We use a fixed port (rather than `0` for ephemeral)
  // because Next.js inlines `NEXT_PUBLIC_SUPABASE_URL` into the EDGE bundle
  // at build time — middleware code that calls `supabase.auth.getUser()`
  // would otherwise hit the build-time placeholder URL, not the dynamic
  // mock URL. By binding the mock to the same port as the placeholder,
  // both the (Node) server runtime AND the edge runtime reach the right
  // server without rebuilding for every run.
  port: number;
};

export async function startMockGotrue(options: MockGoTrueOptions): Promise<MockGoTrueHandle> {
  const server = createServer((req, res) => handleRequest(req, res, options));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('mock-gotrue: failed to bind to the requested port');
  }

  const { port }: AddressInfo = address;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () => closeServer(server),
  };
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: MockGoTrueOptions,
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
    const expected = `Bearer ${options.fixedToken}`;
    if (header === expected) {
      respondJson(res, 200, options.user);
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

  respondJson(res, 404, { code: 404, msg: 'mock-gotrue: route not found', method, path });
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
