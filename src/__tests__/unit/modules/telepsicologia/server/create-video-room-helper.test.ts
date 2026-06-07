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
  updatedRoom?: Record<string, unknown>;
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
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([options.updatedRoom ?? { id: 'room-1' }]),
        }),
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
  generateCallToken: ReturnType<typeof vi.fn>;
} {
  const getOrCreate = overrides?.getOrCreate ?? vi.fn().mockResolvedValue({});
  const upsertUsers = vi.fn().mockResolvedValue({});
  const generateCallToken = vi.fn().mockReturnValue('fake-patient-jwt');

  const client = {
    upsertUsers,
    video: {
      call: vi.fn().mockReturnValue({ getOrCreate }),
    },
    generateCallToken,
  } as unknown as StreamClient;

  return { client, getOrCreate, upsertUsers, generateCallToken };
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

  it('returns a fully activated room (stream_call_id IS NOT NULL) untouched, with no Stream side effects', async () => {
    const { client, getOrCreate, upsertUsers, generateCallToken } = makeStreamClient();
    // First select resolves a fully activated room (stream_call_id present) → return untouched.
    const activatedRoom = {
      id: 'existing-room',
      streamCallId: 'session-existing',
      patientToken: 'a'.repeat(64),
      patientJwt: 'already-minted-jwt',
    };
    const db = makeMockDb({ selectResults: [[activatedRoom]] });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await createVideoRoomHelper(client, sessionWithPatient, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room).toEqual(activatedRoom);

    // No Stream side effects, no DB write on the idempotent path
    expect(upsertUsers).not.toHaveBeenCalled();
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(generateCallToken).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('activates a reserved room (stream_call_id IS NULL) via UPDATE, preserving its patient_token and window', async () => {
    const { client, getOrCreate, upsertUsers, generateCallToken } = makeStreamClient();

    const reservedToken = 'b'.repeat(64);
    const reservedAvailableFrom = new Date('2026-06-01T14:50:00.000Z');
    const reservedExpiresAt = new Date('2026-06-01T17:00:00.000Z');
    const reservedRoom = {
      id: 'reserved-room',
      sessionId: sessionWithPatient.id,
      userId: sessionWithPatient.userId,
      streamCallId: null,
      patientToken: reservedToken,
      patientJwt: null,
      availableFrom: reservedAvailableFrom,
      expiresAt: reservedExpiresAt,
      status: 'pending',
    };
    const updatedRoom = {
      ...reservedRoom,
      streamCallId: `session-${sessionWithPatient.id}`,
      patientJwt: 'fake-patient-jwt',
    };

    // 1st select: reserved room found. 2nd select: patient-type lookup.
    const db = makeMockDb({
      selectResults: [[reservedRoom], []],
      updatedRoom,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await createVideoRoomHelper(client, sessionWithPatient, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Stream side effects ran (users registered, call created, JWT minted)
    expect(upsertUsers).toHaveBeenCalledOnce();
    expect(getOrCreate).toHaveBeenCalledOnce();
    expect(generateCallToken).toHaveBeenCalledOnce();

    // upsertUsers must run BEFORE getOrCreate (client join needs the user to exist)
    expect(upsertUsers.mock.invocationCallOrder[0]!).toBeLessThan(
      getOrCreate.mock.invocationCallOrder[0]!,
    );

    // Activation is an UPDATE, never an INSERT
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.insert).not.toHaveBeenCalled();

    // The UPDATE sets only stream_call_id + patient_jwt — token/window preserved.
    const setCall = db.update.mock.results[0]!.value.set as ReturnType<typeof vi.fn>;
    const setArg = setCall.mock.calls[0]![0] as Record<string, unknown>;
    expect(setArg).toEqual({
      streamCallId: `session-${sessionWithPatient.id}`,
      patientJwt: 'fake-patient-jwt',
    });
    expect(setArg).not.toHaveProperty('patientToken');
    expect(setArg).not.toHaveProperty('availableFrom');
    expect(setArg).not.toHaveProperty('expiresAt');

    // The patient JWT reuses the reserved row's expires_at to bound validity,
    // never a freshly generated token.
    expect(result.room).toEqual(updatedRoom);

    // No fresh patient_token was generated for the activated row.
    expect(result.room.patientToken).toBe(reservedToken);
  });

  it('runs the full INSERT path when no existing row is present (backward compat)', async () => {
    const { client, getOrCreate, upsertUsers, generateCallToken } = makeStreamClient();
    // No existing room (first select empty); patient-type lookup (second select).
    const insertedRoom = { id: 'room-1', streamCallId: `session-${sessionWithPatient.id}` };
    const db = makeMockDb({ selectResults: [[], []], insertedRoom });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await createVideoRoomHelper(client, sessionWithPatient, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room).toEqual(insertedRoom);

    // Full creation: INSERT runs, UPDATE does not, Stream side effects run.
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.update).not.toHaveBeenCalled();
    expect(upsertUsers).toHaveBeenCalledOnce();
    expect(getOrCreate).toHaveBeenCalledOnce();
    expect(generateCallToken).toHaveBeenCalledOnce();
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
      message: 'Erro inesperado ao criar sala de vídeo. Tente novamente.',
    });

    expect(mockLoggerError).toHaveBeenCalledOnce();
    const [logFields] = mockLoggerError.mock.calls[0]! as [Record<string, unknown>, string];
    expect(logFields).toMatchObject({
      event: 'create_video_room_helper_failed',
      errorMessage: 'Stream API is down',
    });
  });
});
