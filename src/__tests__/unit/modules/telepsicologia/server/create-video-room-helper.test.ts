/**
 * Unit tests for `createVideoRoomHelper`.
 *
 * The DB is mocked at the query-builder level so these run without a container.
 * Behavior covered:
 *   - Stream `call.getOrCreate()` receives `settings_override.recording` with
 *     `{ mode: 'available', quality: '1080p', audio_only: false }` (the
 *     recording-fix contract).
 *   - On a non-Postgres Stream failure, the helper returns `{ ok: false }` and
 *     the error log includes `errorMessage`.
 *
 * Cross-boundary behavior against real Postgres (idempotency, RLS, the actual
 * INSERT) is covered by the integration test.
 */

import type { StreamClient } from '@stream-io/node-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createVideoRoomHelper,
  type SessionData,
} from '@/modules/telepsicologia/server/create-video-room-helper';

// ---------------------------------------------------------------------------
// Mock logger — capture error calls to assert on the structured fields.
// ---------------------------------------------------------------------------

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock DB — select(...).from(...).where(...).limit() resolves to `rows`.
// Two selects happen on the happy path: (1) existing-room lookup,
// (2) patient-type lookup. insert(...).values(...).returning() resolves to the
// inserted row. The where().limit() returns are queued in call order.
// ---------------------------------------------------------------------------

// Loose DB type for the mock — the helper accepts any Drizzle Postgres client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockDb = any;

function makeMockDb(options: {
  selectResults: Record<string, unknown>[][];
  insertedRoom?: Record<string, unknown>;
}): MockDb {
  let selectIndex = 0;

  const db = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            const result = options.selectResults[selectIndex] ?? [];
            selectIndex += 1;
            return Promise.resolve(result);
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([options.insertedRoom ?? { id: 'room-1' }]),
      }),
    }),
  };

  return db;
}

// ---------------------------------------------------------------------------
// Mock Stream client — captures the `getOrCreate` argument for assertions.
// ---------------------------------------------------------------------------

function makeStreamClient(overrides?: { getOrCreate?: ReturnType<typeof vi.fn> }): {
  client: StreamClient;
  getOrCreate: ReturnType<typeof vi.fn>;
  upsertUsers: ReturnType<typeof vi.fn>;
} {
  const getOrCreate = overrides?.getOrCreate ?? vi.fn().mockResolvedValue({});
  const upsertUsers = vi.fn().mockResolvedValue({});

  const client = {
    upsertUsers,
    video: {
      call: vi.fn().mockReturnValue({ getOrCreate }),
    },
    generateCallToken: vi.fn().mockReturnValue('fake-patient-jwt'),
  } as unknown as StreamClient;

  return { client, getOrCreate, upsertUsers };
}

const session: SessionData = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  patientId: null,
  startAt: new Date('2026-06-01T15:00:00.000Z'),
  endAt: new Date('2026-06-01T16:00:00.000Z'),
  psychologistName: 'Dr. Ana Souza',
  patientFullName: null,
};

/** Session with a linked patient — used to assert the patient is also upserted. */
const sessionWithPatient: SessionData = {
  ...session,
  patientId: '33333333-3333-3333-3333-333333333333',
  patientFullName: 'João da Silva',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createVideoRoomHelper', () => {
  it('passes settings_override.recording with the mandated 1080p configuration to getOrCreate', async () => {
    const { client, getOrCreate } = makeStreamClient();
    // No existing room (first select empty); no patient lookup needed (patientId null).
    const db = makeMockDb({ selectResults: [[]], insertedRoom: { id: 'room-1' } });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await createVideoRoomHelper(client, session, db);

    expect(result.ok).toBe(true);
    expect(getOrCreate).toHaveBeenCalledOnce();

    const arg = getOrCreate.mock.calls[0]![0] as {
      data: { settings_override: { recording: unknown } };
    };
    expect(arg.data.settings_override.recording).toEqual({
      mode: 'available',
      quality: '1080p',
      audio_only: false,
    });
  });

  it('upserts both psychologist and patient into Stream before getOrCreate', async () => {
    const { client, getOrCreate, upsertUsers } = makeStreamClient();
    // No existing room (first select empty); patient-type lookup (second select).
    const db = makeMockDb({ selectResults: [[], []], insertedRoom: { id: 'room-1' } });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await createVideoRoomHelper(client, sessionWithPatient, db);

    expect(result.ok).toBe(true);
    expect(upsertUsers).toHaveBeenCalledOnce();

    // Both users registered: psychologist (Supabase UUID) + patient (synthetic id)
    const users = upsertUsers.mock.calls[0]![0] as { id: string; name: string }[];
    expect(users).toEqual([
      { id: sessionWithPatient.userId, name: 'Dr. Ana Souza' },
      { id: `patient-${sessionWithPatient.patientId}`, name: 'João da Silva' },
    ]);

    // upsertUsers must run BEFORE getOrCreate (client join needs the user to exist)
    expect(upsertUsers.mock.invocationCallOrder[0]!).toBeLessThan(
      getOrCreate.mock.invocationCallOrder[0]!,
    );
  });

  it('upserts only the psychologist when no patient is linked', async () => {
    const { client, upsertUsers } = makeStreamClient();
    // No existing room (first select empty); no patient lookup (patientId null).
    const db = makeMockDb({ selectResults: [[]], insertedRoom: { id: 'room-1' } });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await createVideoRoomHelper(client, session, db);

    expect(result.ok).toBe(true);
    expect(upsertUsers).toHaveBeenCalledOnce();

    const users = upsertUsers.mock.calls[0]![0] as { id: string; name: string }[];
    expect(users).toEqual([{ id: session.userId, name: 'Dr. Ana Souza' }]);
  });

  it('does NOT upsert users on the idempotent early-return path (room already exists)', async () => {
    const { client, getOrCreate, upsertUsers } = makeStreamClient();
    // First select resolves an existing room → early return.
    const db = makeMockDb({ selectResults: [[{ id: 'existing-room' }]] });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await createVideoRoomHelper(client, sessionWithPatient, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room).toEqual({ id: 'existing-room' });

    // No Stream side effects on the idempotent path
    expect(upsertUsers).not.toHaveBeenCalled();
    expect(getOrCreate).not.toHaveBeenCalled();
  });

  it('returns ok:false and logs errorMessage when Stream throws a non-Postgres error', async () => {
    const streamError = new Error('Stream API is down');
    const getOrCreate = vi.fn().mockRejectedValue(streamError);
    const { client } = makeStreamClient({ getOrCreate });
    // First select: no existing room. A second select would happen on the
    // catch-path re-fetch only for a 23505 error, which this is not.
    const db = makeMockDb({ selectResults: [[]] });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await createVideoRoomHelper(client, session, db);

    expect(result).toEqual({
      ok: false,
      error: 'unknown',
      message: 'Erro inesperado ao criar sala de video. Tente novamente.',
    });

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [logFields] = mockLoggerError.mock.calls[0]! as [Record<string, unknown>, string];
    expect(logFields).toMatchObject({
      event: 'create_video_room_helper_failed',
      errorMessage: 'Stream API is down',
    });
  });
});
