import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { psychologistProfileFactory } from '@/__tests__/integration/factories/psychologist-profiles';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// We mock the logger so we can assert the `status_mirror_drift` warn line is
// emitted. The integration suite sets `LOG_LEVEL=silent`, which means a real
// pino logger would swallow the call — so the spy approach is required.
//
// The mock must be installed BEFORE the SUT (`getAccountStatus`) is imported,
// so we use a top-level `vi.mock` and `await import` the module inside each
// test.
const warnSpy = vi.fn();
const errorSpy = vi.fn();
const infoSpy = vi.fn();
const debugSpy = vi.fn();

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]): void => {
      warnSpy(...args);
    },
    error: (...args: unknown[]): void => {
      errorSpy(...args);
    },
    info: (...args: unknown[]): void => {
      infoSpy(...args);
    },
    debug: (...args: unknown[]): void => {
      debugSpy(...args);
    },
  },
  // `redactPaths` is exported by the real logger module; the auth signin
  // path does not import it from here, but we expose a stub anyway so the
  // mock matches the public surface.
  redactPaths: [],
}));

async function seedAuthUser(userId: string, email = `${userId}@example.com`): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      sql`INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${userId}, ${email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`,
    );
  });
}

beforeEach(() => {
  warnSpy.mockReset();
  errorSpy.mockReset();
  infoSpy.mockReset();
  debugSpy.mockReset();
});

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(crpValidationQueue);
    await db.delete(psychologistProfiles);
    await db.execute(sql`DELETE FROM auth.users`);
  });
});

describe('getAccountStatus (integration)', () => {
  it('returns the DB status with source=db and no drift when no JWT mirror is supplied', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_verification',
        }),
      );
    });

    const { getAccountStatus } = await import('@/modules/account-lifecycle');
    const result = await getAccountStatus(userId);

    expect(result).toEqual({
      status: 'pending_verification',
      source: 'db',
      drift: false,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns status=null with source=db when the user has no profile row', async () => {
    const unknownUserId = randomUUID();

    const { getAccountStatus } = await import('@/modules/account-lifecycle');
    const result = await getAccountStatus(unknownUserId);

    expect(result).toEqual({ status: null, source: 'db', drift: false });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports source=jwt and no drift when the JWT mirror agrees with the DB row and is fresh', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_verification',
        }),
      );
    });

    const rows = await runAsService(async (db) => db.select().from(psychologistProfiles));
    const statusChangedAtMs = rows[0]!.statusChangedAt.getTime();
    // JWT issued AFTER the most recent transition → fresh.
    const freshIatSeconds = Math.ceil(statusChangedAtMs / 1000) + 60;

    const { getAccountStatus } = await import('@/modules/account-lifecycle');
    const result = await getAccountStatus(userId, {
      accountStatus: 'pending_verification',
      iat: freshIatSeconds,
    });

    expect(result).toEqual({
      status: 'pending_verification',
      source: 'jwt',
      drift: false,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs status_mirror_drift and falls back to DB when the JWT iat is older than status_changed_at', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_verification',
        }),
      );
    });

    const rows = await runAsService(async (db) => db.select().from(psychologistProfiles));
    const statusChangedAtMs = rows[0]!.statusChangedAt.getTime();
    // JWT issued BEFORE the most recent transition → stale.
    const staleIatSeconds = Math.floor(statusChangedAtMs / 1000) - 3600;

    const { getAccountStatus } = await import('@/modules/account-lifecycle');
    const result = await getAccountStatus(userId, {
      // The mirror still reads the *old* value the JWT was issued with
      // (any value works for this test — even the same status, since the
      // freshness check is independent of the value).
      accountStatus: 'pending_verification',
      iat: staleIatSeconds,
    });

    // Source is `db` because we fell back; the status equals the DB column.
    expect(result.source).toBe('db');
    expect(result.drift).toBe(true);
    expect(result.status).toBe('pending_verification');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload, message] = warnSpy.mock.calls[0]!;
    expect(payload).toMatchObject({
      event: 'status_mirror_drift',
      userId,
      stale: true,
      // `disagree` may be true or false depending on whether the mirror
      // happened to carry the right value — the freshness check alone is
      // enough to set `drift=true`.
    });
    expect(message).toMatch(/JWT account_status mirror is out of sync/);
  });

  it('logs status_mirror_drift when the JWT mirror status disagrees with the DB even if iat is fresh', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_verification',
        }),
      );
    });

    const rows = await runAsService(async (db) => db.select().from(psychologistProfiles));
    const statusChangedAtMs = rows[0]!.statusChangedAt.getTime();
    const freshIatSeconds = Math.ceil(statusChangedAtMs / 1000) + 60;

    const { getAccountStatus } = await import('@/modules/account-lifecycle');
    const result = await getAccountStatus(userId, {
      // Mirror claims `active`, DB says `pending_verification`. iat is fresh
      // so `stale` is false but `disagree` is true.
      accountStatus: 'active',
      iat: freshIatSeconds,
    });

    expect(result.source).toBe('db');
    expect(result.drift).toBe(true);
    expect(result.status).toBe('pending_verification');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      event: 'status_mirror_drift',
      stale: false,
      disagree: true,
    });
  });
});
