// Contract tests for `startMockGotrue`. Anchored on the spec scenarios
// "`startMockGotrue` returns a valid handle" and "`stop()` releases the
// listening socket" of `e2e-test-stack`. The "does `getUser()` succeed
// against the mock" scenario lives in the e2e suite — keep this file scoped
// to handle shape, JWT structure, and socket lifecycle so we test the public
// contract without re-validating `supabase-js` behaviour here.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildFixedJwt,
  startMockGotrue,
  type MockGoTrueHandle,
} from '@/__tests__/e2e/seeded/setup/mock-gotrue';

// Track every handle a test starts so we always release the socket even when
// an assertion fails midway — leaked listeners would poison subsequent runs.
const startedHandles: MockGoTrueHandle[] = [];

async function start(port?: number): Promise<MockGoTrueHandle> {
  const handle = await startMockGotrue(port === undefined ? {} : { port });
  startedHandles.push(handle);
  return handle;
}

afterEach(async () => {
  while (startedHandles.length > 0) {
    const handle = startedHandles.pop();
    if (!handle) continue;
    // Swallow errors here: `stop()` may have already been awaited inside the
    // test (e.g., the rebind case). A second close just resolves with
    // `ERR_SERVER_NOT_RUNNING`, which is fine for cleanup.
    await handle.stop().catch(() => undefined);
  }
});

// Reserve a free OS-assigned port and immediately release it. Lets us drive
// `startMockGotrue` with an ephemeral port without colliding on the helper's
// 54321 default (which a developer may have bound to a local `supabase start`).
async function reserveEphemeralPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      probe.removeListener('error', reject);
      resolve();
    });
  });
  const address = probe.address() as AddressInfo;
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    probe.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

describe('startMockGotrue', () => {
  it('returns a handle with a numeric port, async stop, and three-segment JWT string', async () => {
    const port = await reserveEphemeralPort();

    const handle = await start(port);

    expect(typeof handle.port).toBe('number');
    expect(Number.isInteger(handle.port)).toBe(true);
    expect(handle.port).toBe(port);
    // `stop` is the documented teardown — must be a function whose call
    // produces a Promise (so `await handle.stop()` is meaningful).
    expect(typeof handle.stop).toBe('function');
    expect(handle.stop()).toBeInstanceOf(Promise);
    // After awaiting the call above the server is closed; pop it from cleanup
    // so `afterEach` does not double-close.
    startedHandles.pop();

    // JWT shape: three non-empty base64url segments joined by `.`. Anything
    // less is not a syntactically valid token for `decodeJWT()` consumers.
    expect(typeof handle.jwt).toBe('string');
    const segments = handle.jwt.split('.');
    expect(segments).toHaveLength(3);
    expect(segments.every((segment) => segment.length > 0)).toBe(true);
  });

  it('mints a JWT whose payload matches buildFixedJwt for the default seeded user', async () => {
    const port = await reserveEphemeralPort();

    const handle = await start(port);

    // Decode the payload segment and assert the contract claims. We do NOT
    // verify the signature: `buildFixedJwt` writes the literal string
    // `mock-signature` as the third segment by design, so cryptographic
    // verification is meaningless. The honest contract check is "the payload
    // matches what `buildFixedJwt` would produce for the helper's default".
    const [, payloadSegment, signatureSegment] = handle.jwt.split('.');
    expect(signatureSegment).toBe('mock-signature');

    const decoded = JSON.parse(Buffer.from(payloadSegment ?? '', 'base64url').toString('utf8')) as {
      sub: string;
      email: string;
      aud: string;
      role: string;
      exp: number;
      iat: number;
    };

    // Defaults are documented in the helper: stable seeded user with id
    // `00000000-0000-4000-8000-000000000001`, email `seed@example.com`, and
    // `aud: 'authenticated'`. Pin them so a future refactor does not
    // silently change the e2e fixture identity.
    expect(decoded.sub).toBe('00000000-0000-4000-8000-000000000001');
    expect(decoded.email).toBe('seed@example.com');
    expect(decoded.aud).toBe('authenticated');
    expect(decoded.role).toBe('authenticated');
    // Long-lived but not infinite: helper sets `exp` ~30 days out from `iat`.
    expect(decoded.exp).toBeGreaterThan(decoded.iat);

    // Sanity check: a freshly built JWT with the same claims has the same
    // shape (same header + signature segments). This is what "matches
    // buildFixedJwt" means in practice.
    const rebuilt = buildFixedJwt(decoded);
    const [rebuiltHeader, , rebuiltSignature] = rebuilt.split('.');
    const [actualHeader] = handle.jwt.split('.');
    expect(rebuiltHeader).toBe(actualHeader);
    expect(rebuiltSignature).toBe('mock-signature');
  });

  it('releases the listening socket on stop() so the same port is re-bindable', async () => {
    // Use one ephemeral port for both starts to prove `stop()` releases the
    // exact socket we just bound. Picking 54321 (the helper default) would
    // risk colliding with a developer's local `supabase start`.
    const port = await reserveEphemeralPort();

    const first = await start(port);
    expect(first.port).toBe(port);
    await first.stop();
    startedHandles.pop(); // already closed; skip in afterEach

    // If `stop()` had not freed the socket this would throw `EADDRINUSE`.
    const second = await start(port);
    expect(second.port).toBe(port);
  });
});
