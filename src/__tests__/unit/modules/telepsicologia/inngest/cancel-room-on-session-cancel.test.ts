/**
 * Unit tests for `processSessionCancelled` decision logic.
 *
 * The DB is mocked at the query-builder level so these run without a container.
 * Behavior covered:
 *   - No cleanable room → returns { action: 'skipped', reason: 'no_room' },
 *     no Stream call, no transaction.
 *   - Room found → ends Stream call, runs the cleanup transaction, returns
 *     { action: 'expired_room', roomId }.
 *   - Stream .end() throws → onStreamError is invoked and the transaction
 *     still runs (DB cleanup is not blocked by a Stream failure).
 *
 * Cross-boundary behavior against real Postgres (RLS, the actual WHERE scoping,
 * the transaction) is covered by the integration test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  processSessionCancelled,
  type CancelRoomOnSessionCancelDeps,
} from '@/modules/telepsicologia/inngest/cancel-room-on-session-cancel';

// ---------------------------------------------------------------------------
// Mock DB — select(...).from(...).where(...).limit() resolves to `rooms`.
// transaction(cb) invokes cb with a tx exposing update/insert chains.
// ---------------------------------------------------------------------------

interface RoomRow {
  id: string;
  sessionId: string;
  userId: string;
  streamCallId: string;
}

function makeMockDb(rooms: RoomRow[]) {
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    };
    return cb(tx);
  });

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rooms),
        }),
      }),
    }),
    transaction,
  };

  return { db, transaction };
}

const mockEnd = vi.fn().mockResolvedValue({});
const mockStreamClient = {
  video: { call: () => ({ end: mockEnd }) },
};

function makeDeps(
  rooms: RoomRow[],
  overrides?: Partial<CancelRoomOnSessionCancelDeps>,
): {
  deps: CancelRoomOnSessionCancelDeps;
  transaction: ReturnType<typeof makeMockDb>['transaction'];
} {
  const { db, transaction } = makeMockDb(rooms);
  return {
    deps: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      getStreamClient: () => mockStreamClient,
      ...overrides,
    },
    transaction,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processSessionCancelled', () => {
  it('returns skipped/no_room and does nothing when no room is found', async () => {
    const { deps, transaction } = makeDeps([]);

    const result = await processSessionCancelled(
      { sessionId: 'session-1', userId: 'user-1' },
      deps,
    );

    expect(result).toEqual({ action: 'skipped', reason: 'no_room' });
    expect(mockEnd).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('ends the Stream call and runs the cleanup transaction when a room is found', async () => {
    const room: RoomRow = {
      id: 'room-1',
      sessionId: 'session-1',
      userId: 'user-1',
      streamCallId: 'session-session-1',
    };
    const { deps, transaction } = makeDeps([room]);

    const result = await processSessionCancelled(
      { sessionId: 'session-1', userId: 'user-1' },
      deps,
    );

    expect(result).toEqual({ action: 'expired_room', roomId: 'room-1' });
    expect(mockEnd).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('invokes onStreamError but still runs the transaction when Stream .end() throws', async () => {
    const room: RoomRow = {
      id: 'room-1',
      sessionId: 'session-1',
      userId: 'user-1',
      streamCallId: 'session-session-1',
    };
    const throwingStreamClient = {
      video: {
        call: () => ({ end: vi.fn().mockRejectedValue(new Error('boom')) }),
      },
    };
    const onStreamError = vi.fn();
    const { deps, transaction } = makeDeps([room], {
      getStreamClient: () => throwingStreamClient,
      onStreamError,
    });

    const result = await processSessionCancelled(
      { sessionId: 'session-1', userId: 'user-1' },
      deps,
    );

    expect(result).toEqual({ action: 'expired_room', roomId: 'room-1' });
    expect(onStreamError).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledOnce();
  });
});
