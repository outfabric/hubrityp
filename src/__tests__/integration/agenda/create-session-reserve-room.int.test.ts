import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionImpl } from '@/modules/agenda/server/create-session';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';
import type * as EnvModule from '@/shared/env';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// `serverEnv.APP_URL` is frozen at module-eval time from `process.env`, so we
// cannot mutate it after the fact. Mock the env barrel with `importActual` to
// preserve every other value (the Drizzle client reads DATABASE_URL from it)
// and expose a mutable `APP_URL` holder controlled per-test via `setAppUrl`.
// `vi.mock` is hoisted above these imports by Vitest, so `create-session`
// resolves the mocked `serverEnv`.
// ---------------------------------------------------------------------------
const envHolder = vi.hoisted(() => ({ appUrl: undefined as string | undefined }));

vi.mock('@/shared/env', async (importActual) => {
  const actual = await importActual<typeof EnvModule>();
  return {
    ...actual,
    get serverEnv() {
      return { ...actual.serverEnv, APP_URL: envHolder.appUrl };
    },
  };
});

function setAppUrl(url: string | undefined): void {
  envHolder.appUrl = url;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createSessionImpl>[0];
}

/** Returns an ISO 8601 datetime string for a future date. */
function futureDate(hoursFromNow: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
}

afterEach(async () => {
  setAppUrl(undefined);
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// createSessionImpl — eager video-room reservation
// ---------------------------------------------------------------------------

describe('createSessionImpl video-room reservation', () => {
  it('reserves a video_rooms row (stream_call_id NULL) for an online session', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    setAppUrl('https://app.hubrity.com');
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {
      is_blocking: true,
      blocking_title: 'Online slot',
      start_at: futureDate(24),
      duration_minutes: 50,
      modality: 'online',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, result.sessionId));
    });

    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.userId).toBe(userId);
    expect(rooms[0]!.streamCallId).toBeNull();
    expect(rooms[0]!.patientJwt).toBeNull();
    expect(rooms[0]!.status).toBe('pending');
    expect(rooms[0]!.patientToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('includes patientVideoUrl when APP_URL is configured (online session)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    setAppUrl('https://app.hubrity.com');
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {
      is_blocking: true,
      blocking_title: 'Online slot',
      start_at: futureDate(48),
      duration_minutes: 50,
      modality: 'online',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rooms = await runAsService(async (db) => {
      return db
        .select({ patientToken: videoRooms.patientToken })
        .from(videoRooms)
        .where(eq(videoRooms.sessionId, result.sessionId));
    });
    const token = rooms[0]!.patientToken;

    expect(result.patientVideoUrl).toBe(`https://app.hubrity.com/v/${token}`);
  });

  it('omits patientVideoUrl when APP_URL is not configured (online session)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    setAppUrl(undefined);
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {
      is_blocking: true,
      blocking_title: 'Online slot',
      start_at: futureDate(72),
      duration_minutes: 50,
      modality: 'online',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patientVideoUrl).toBeUndefined();

    // The room is still reserved even without APP_URL.
    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, result.sessionId));
    });
    expect(rooms).toHaveLength(1);
  });

  it('does not reserve a video_rooms row for an in-person session', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    setAppUrl('https://app.hubrity.com');
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {
      is_blocking: true,
      blocking_title: 'In-person slot',
      start_at: futureDate(96),
      duration_minutes: 50,
      modality: 'in_person',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patientVideoUrl).toBeUndefined();

    const rooms = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, result.sessionId));
    });
    expect(rooms).toHaveLength(0);
  });
});
