// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parsePresencePayload,
  useVideoRoomPresence,
} from '@/modules/telepsicologia/hooks/use-video-room-presence';

// ---------------------------------------------------------------------------
// Mocks — Supabase browser client. Captures the channel name, the channel
// options (so we can assert the PRIVATE flag), and the broadcast handler so a
// test can drive incoming `presence` events.
// ---------------------------------------------------------------------------

let broadcastHandler: ((message: { payload: unknown }) => void) | null = null;
let channelName: string | null = null;
let channelOpts: unknown = null;
let registeredEvent: { type: string; filter: { event: string } } | null = null;

const mockRemoveChannel = vi.fn();
const mockSubscribe = vi.fn();
const mockChannelFactory = vi.fn();

function makeChannel() {
  const channel = {
    on: vi.fn(
      (type: string, filter: { event: string }, handler: (m: { payload: unknown }) => void) => {
        registeredEvent = { type, filter };
        broadcastHandler = handler;
        return channel;
      },
    ),
    subscribe: vi.fn(() => {
      mockSubscribe();
      return channel;
    }),
  };
  return channel;
}

vi.mock('@/shared/supabase/client', () => ({
  createBrowserClient: (): {
    channel: (name: string, opts: unknown) => ReturnType<typeof makeChannel>;
    removeChannel: (channel: unknown) => void;
  } => ({
    channel: (name: string, opts: unknown) => {
      mockChannelFactory(name, opts);
      channelName = name;
      channelOpts = opts;
      return makeChannel();
    },
    removeChannel: (channel: unknown): void => {
      mockRemoveChannel(channel);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BASE = new Date('2026-06-26T12:00:00.000Z').getTime();
const TTL_MS = 1_000;
const INTERVAL_MS = 100;

function emit(payload: unknown): void {
  act(() => {
    broadcastHandler?.({ payload });
  });
}

function heartbeatAtNow(): { room_id: string; last_seen_at: string } {
  return { room_id: ROOM_ID, last_seen_at: new Date(Date.now()).toISOString() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVideoRoomPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broadcastHandler = null;
    channelName = null;
    channelOpts = null;
    registeredEvent = null;
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to the PRIVATE per-room channel with the presence event', () => {
    renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: USER_ID,
        initialLastSeenAt: null,
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    expect(channelName).toBe(`video-room:${ROOM_ID}`);
    expect(channelOpts).toEqual({ config: { private: true } });
    expect(registeredEvent).toEqual({ type: 'broadcast', filter: { event: 'presence' } });
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('is present when seeded with a fresh lastSeenAt', () => {
    const { result } = renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: USER_ID,
        initialLastSeenAt: new Date(BASE),
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    expect(result.current).toBe(true);
  });

  it('is absent when seeded with a stale lastSeenAt', () => {
    const { result } = renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: USER_ID,
        initialLastSeenAt: new Date(BASE - TTL_MS - 1),
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    expect(result.current).toBe(false);
  });

  it('a heartbeat refreshes freshness and keeps the patient present', () => {
    const { result } = renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: USER_ID,
        initialLastSeenAt: null,
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    // Not present until a heartbeat arrives.
    expect(result.current).toBe(false);

    emit(heartbeatAtNow());
    expect(result.current).toBe(true);

    // Advance to just under the TTL, then heartbeat again → window resets.
    act(() => {
      vi.advanceTimersByTime(TTL_MS - INTERVAL_MS);
    });
    expect(result.current).toBe(true);
    emit(heartbeatAtNow());

    // Advance again by nearly a full TTL — still present because the second
    // heartbeat reset the freshness window.
    act(() => {
      vi.advanceTimersByTime(TTL_MS - INTERVAL_MS);
    });
    expect(result.current).toBe(true);
  });

  it('clears presence immediately on a departure (null last_seen_at) broadcast', () => {
    const { result } = renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: USER_ID,
        initialLastSeenAt: new Date(BASE),
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    expect(result.current).toBe(true);

    // Departure arrives well before the TTL would have elapsed.
    emit({ room_id: ROOM_ID, last_seen_at: null });
    expect(result.current).toBe(false);
  });

  it('auto-clears presence after the TTL elapses with no further heartbeats', () => {
    const { result } = renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: USER_ID,
        initialLastSeenAt: new Date(BASE),
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(TTL_MS + INTERVAL_MS);
    });

    expect(result.current).toBe(false);
  });

  it('ignores malformed payloads (no state change)', () => {
    const { result } = renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: USER_ID,
        initialLastSeenAt: new Date(BASE),
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    expect(result.current).toBe(true);

    emit(undefined);
    emit(null);
    emit('not-an-object');
    emit({ room_id: ROOM_ID }); // missing last_seen_at field
    emit({ room_id: ROOM_ID, last_seen_at: 'not-a-date' });
    emit({ room_id: ROOM_ID, last_seen_at: { nested: true } });

    // None of the above are a departure → presence stays true.
    expect(result.current).toBe(true);
  });

  it('removes the channel and clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: USER_ID,
        initialLastSeenAt: new Date(BASE),
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    unmount();

    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalled();
  });

  it('is a no-op when roomId is falsy', () => {
    renderHook(() =>
      useVideoRoomPresence({
        roomId: null,
        userId: USER_ID,
        initialLastSeenAt: null,
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    expect(mockChannelFactory).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('is a no-op when userId is falsy', () => {
    renderHook(() =>
      useVideoRoomPresence({
        roomId: ROOM_ID,
        userId: undefined,
        initialLastSeenAt: null,
        ttlMs: TTL_MS,
        evaluationIntervalMs: INTERVAL_MS,
      }),
    );

    expect(mockChannelFactory).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});

describe('parsePresencePayload', () => {
  it('parses an ISO-string heartbeat into epoch milliseconds', () => {
    const iso = '2026-06-26T12:00:00.000Z';
    expect(parsePresencePayload({ last_seen_at: iso })).toEqual({
      kind: 'heartbeat',
      at: Date.parse(iso),
    });
  });

  it('parses a numeric-epoch heartbeat', () => {
    expect(parsePresencePayload({ last_seen_at: 1_700_000_000_000 })).toEqual({
      kind: 'heartbeat',
      at: 1_700_000_000_000,
    });
  });

  it('treats an explicit null last_seen_at as a departure', () => {
    expect(parsePresencePayload({ last_seen_at: null })).toEqual({ kind: 'departure' });
  });

  it('ignores a non-object payload', () => {
    expect(parsePresencePayload(undefined)).toEqual({ kind: 'ignore' });
    expect(parsePresencePayload(null)).toEqual({ kind: 'ignore' });
    expect(parsePresencePayload('string')).toEqual({ kind: 'ignore' });
    expect(parsePresencePayload(42)).toEqual({ kind: 'ignore' });
  });

  it('ignores a payload missing the last_seen_at field', () => {
    expect(parsePresencePayload({ room_id: 'x' })).toEqual({ kind: 'ignore' });
  });

  it('ignores an unparseable timestamp', () => {
    expect(parsePresencePayload({ last_seen_at: 'not-a-date' })).toEqual({ kind: 'ignore' });
    expect(parsePresencePayload({ last_seen_at: { nested: true } })).toEqual({ kind: 'ignore' });
    expect(parsePresencePayload({ last_seen_at: Number.NaN })).toEqual({ kind: 'ignore' });
  });
});
