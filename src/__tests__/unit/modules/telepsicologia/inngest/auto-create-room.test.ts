/**
 * Unit tests for deferred-creation helpers in auto-create-room.ts.
 *
 * Verifies:
 *   - `computeWakeUpAt` returns exactly 1 hour before the session start, which
 *     is the instant the Inngest function sleeps until before provisioning the
 *     video room.
 *   - `processSessionCreated` / `processSessionUpdated` THROW (not return an
 *     error result) when the room-creation helper fails, so Inngest's
 *     `retries: 3` engages instead of silently succeeding the step.
 *   - `AutoCreateRoomResult` no longer carries an `error` variant (compile-time
 *     assertion — the failure mode is now an exception, not a result).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionCreatedEvent, SessionUpdatedEvent } from '@/modules/agenda/lib/session-events';
import {
  computeWakeUpAt,
  processSessionCreated,
  processSessionUpdated,
  type AutoCreateRoomDeps,
  type AutoCreateRoomResult,
} from '@/modules/telepsicologia/inngest/auto-create-room';
import type { CreateVideoRoomHelperResult } from '@/modules/telepsicologia/server/create-video-room-helper';

describe('auto-create-room: computeWakeUpAt', () => {
  it('returns exactly 1 hour before the session start', () => {
    const startAt = new Date('2026-06-01T15:00:00.000Z');

    const wakeUpAt = computeWakeUpAt(startAt);

    expect(wakeUpAt.toISOString()).toBe('2026-06-01T14:00:00.000Z');
  });

  it('does not mutate the input date', () => {
    const startAt = new Date('2026-06-01T15:00:00.000Z');
    const original = startAt.getTime();

    computeWakeUpAt(startAt);

    expect(startAt.getTime()).toBe(original);
  });

  it('handles sub-hour and day-boundary offsets correctly', () => {
    const startAt = new Date('2026-06-01T00:30:00.000Z');

    const wakeUpAt = computeWakeUpAt(startAt);

    expect(wakeUpAt.toISOString()).toBe('2026-05-31T23:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Helper-failure propagation — the decision functions must throw, not swallow.
// ---------------------------------------------------------------------------

const userId = '22222222-2222-2222-2222-222222222222';
const sessionId = '11111111-1111-1111-1111-111111111111';

const baseEvent = {
  sessionId,
  userId,
  patientId: null,
  modality: 'online',
  status: 'scheduled',
  startAt: new Date('2026-06-01T15:00:00.000Z'),
  endAt: new Date('2026-06-01T16:00:00.000Z'),
} satisfies SessionCreatedEvent;

const failingHelperResult: CreateVideoRoomHelperResult = {
  ok: false,
  error: 'unknown',
  message: 'boom',
};

type ExistingRoomRow = { id: string; streamCallId: string | null };

function makeDeps(
  helperResult: CreateVideoRoomHelperResult,
  existingRoom: ExistingRoomRow[] = [],
): AutoCreateRoomDeps {
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(existingRoom),
        }),
      }),
    }),
  };

  const deps: AutoCreateRoomDeps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: db as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getStreamClient: vi.fn().mockReturnValue({}) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createVideoRoomHelper: vi.fn().mockResolvedValue(helperResult) as any,
  };

  return deps;
}

const successfulHelperResult: CreateVideoRoomHelperResult = {
  ok: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  room: { id: 'room-created-id' } as any,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auto-create-room: helper-failure propagation', () => {
  it('processSessionCreated throws when the helper returns { ok: false }', async () => {
    const deps = makeDeps(failingHelperResult);

    await expect(processSessionCreated(baseEvent, deps)).rejects.toThrow(
      /Video room creation failed/,
    );
  });

  it('processSessionUpdated throws when the helper returns { ok: false }', async () => {
    const updatedEvent: SessionUpdatedEvent = { ...baseEvent };
    // No existing room → falls through to createRoom, which throws on failure.
    const deps = makeDeps(failingHelperResult, []);

    await expect(processSessionUpdated(updatedEvent, deps)).rejects.toThrow(
      /Video room creation failed/,
    );
  });

  it('AutoCreateRoomResult does not include an error variant', () => {
    // Compile-time assertion: an `{ action: 'error' }` member is no longer
    // assignable to AutoCreateRoomResult. If the variant is reintroduced this
    // line stops type-checking and `npm run typecheck` fails.
    const allowedActions: AutoCreateRoomResult['action'][] = [
      'created',
      'existing',
      'skipped',
      'expired_room',
    ];

    // @ts-expect-error — 'error' is intentionally NOT a valid action.
    const forbidden: AutoCreateRoomResult['action'] = 'error';

    expect(allowedActions).not.toContain(forbidden);
  });
});

// ---------------------------------------------------------------------------
// Activation guard — distinguishes a reserved room (streamCallId IS NULL,
// proceed to activation) from a fully activated room (streamCallId IS NOT
// NULL, skip) and from no room at all (full creation, backward compat).
// ---------------------------------------------------------------------------

describe('auto-create-room: activation guard (reserved vs. activated room)', () => {
  const updatedEvent: SessionUpdatedEvent = {
    ...baseEvent,
    previousModality: 'online',
  };

  it('proceeds to activation when the existing room is reserved (streamCallId IS NULL)', async () => {
    // A reserved row exists but has no Stream call yet. The guard must NOT
    // short-circuit; it falls through to createRoom (which UPDATEs the row).
    const deps = makeDeps(successfulHelperResult, [{ id: 'reserved-room-id', streamCallId: null }]);

    const result = await processSessionUpdated(updatedEvent, deps);

    expect(result).toEqual({ action: 'created', roomId: 'room-created-id' });
    expect(deps.createVideoRoomHelper).toHaveBeenCalledOnce();
  });

  it('skips (returns existing) when the room is fully activated (streamCallId IS NOT NULL)', async () => {
    // A fully activated room already has a Stream call — short-circuit.
    const deps = makeDeps(successfulHelperResult, [
      { id: 'activated-room-id', streamCallId: 'stream-call-abc' },
    ]);

    const result = await processSessionUpdated(updatedEvent, deps);

    expect(result).toEqual({ action: 'existing', roomId: 'activated-room-id' });
    expect(deps.createVideoRoomHelper).not.toHaveBeenCalled();
  });

  it('triggers full creation when no existing room row exists (backward compat)', async () => {
    // No reserved row at all — createRoom falls back to the full INSERT path.
    const deps = makeDeps(successfulHelperResult, []);

    const result = await processSessionUpdated(updatedEvent, deps);

    expect(result).toEqual({ action: 'created', roomId: 'room-created-id' });
    expect(deps.createVideoRoomHelper).toHaveBeenCalledOnce();
  });
});
