import { randomBytes, randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listSessionsImpl } from '@/modules/agenda/server/list-sessions';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';
import type * as EnvModule from '@/shared/env';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// `serverEnv.APP_URL` is frozen at module-eval time from `process.env`, so we
// cannot mutate it after the fact. Mock the env barrel with `importActual` to
// preserve every other value (the Drizzle client reads DATABASE_URL from it)
// and expose a mutable `APP_URL` holder controlled per-test via `setAppUrl`.
// `vi.mock` is hoisted above these imports by Vitest, so `list-sessions`
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

const APP_URL = 'https://app.hubrityp.com.br';

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

interface SeedSessionOptions {
  userId: string;
  modality: 'online' | 'in_person';
  startAt: Date;
  endAt: Date;
}

/** Inserts a blocking session row directly and returns its generated id. */
async function seedSession(opts: SeedSessionOptions): Promise<string> {
  return runAsService(async (db) => {
    const [row] = await db
      .insert(sessions)
      .values({
        userId: opts.userId,
        isBlocking: true,
        blockingTitle: 'Test slot',
        modality: opts.modality,
        status: 'scheduled',
        durationMinutes: 50,
        startAt: opts.startAt,
        endAt: opts.endAt,
      })
      .returning({ id: sessions.id });
    return row!.id;
  });
}

/** Reserves a video room for a session and returns its `patient_token`. */
async function seedVideoRoom(
  userId: string,
  sessionId: string,
  availableFrom: Date,
  expiresAt: Date,
): Promise<string> {
  const patientToken = randomBytes(32).toString('hex');
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      userId,
      sessionId,
      patientToken,
      availableFrom,
      expiresAt,
      status: 'pending',
    });
  });
  return patientToken;
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
  } as Parameters<typeof listSessionsImpl>[0];
}

afterEach(async () => {
  setAppUrl(undefined);
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// listSessionsImpl — patientVideoUrl on SessionWithDetails
// ---------------------------------------------------------------------------

describe('listSessionsImpl patientVideoUrl', () => {
  it('returns patientVideoUrl for an online session with a reserved room', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    setAppUrl(APP_URL);

    const startAt = new Date('2026-07-01T13:00:00.000Z');
    const endAt = new Date('2026-07-01T13:50:00.000Z');
    const sessionId = await seedSession({ userId, modality: 'online', startAt, endAt });
    const patientToken = await seedVideoRoom(
      userId,
      sessionId,
      new Date('2026-07-01T12:00:00.000Z'),
      new Date('2026-07-01T15:00:00.000Z'),
    );

    const result = await listSessionsImpl(
      fakeSupabaseClient(userId),
      new Date('2026-06-30T00:00:00.000Z'),
      new Date('2026-07-02T00:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.sessions.find((s) => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session!.patientVideoUrl).toBe(`${APP_URL}/v/${patientToken}`);
  });

  it('returns patientVideoUrl null for an in-person session', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    setAppUrl(APP_URL);

    const startAt = new Date('2026-07-03T13:00:00.000Z');
    const endAt = new Date('2026-07-03T13:50:00.000Z');
    const sessionId = await seedSession({ userId, modality: 'in_person', startAt, endAt });

    const result = await listSessionsImpl(
      fakeSupabaseClient(userId),
      new Date('2026-07-02T00:00:00.000Z'),
      new Date('2026-07-04T00:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.sessions.find((s) => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session!.patientVideoUrl).toBeNull();
  });

  it('returns patientVideoUrl null for an online session without a video_rooms row', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    setAppUrl(APP_URL);

    const startAt = new Date('2026-07-05T13:00:00.000Z');
    const endAt = new Date('2026-07-05T13:50:00.000Z');
    const sessionId = await seedSession({ userId, modality: 'online', startAt, endAt });

    const result = await listSessionsImpl(
      fakeSupabaseClient(userId),
      new Date('2026-07-04T00:00:00.000Z'),
      new Date('2026-07-06T00:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.sessions.find((s) => s.id === sessionId);
    expect(session).toBeDefined();
    expect(session!.patientVideoUrl).toBeNull();
  });
});
