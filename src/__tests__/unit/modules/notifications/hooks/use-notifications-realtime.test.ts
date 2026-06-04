// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Imported from the leaf, NOT the `@/modules/notifications` barrel: the barrel
// re-exports `server-only` read actions, so pulling this client hook through it
// would drag `server-only` into a client context. (Same boundary discipline as
// the dropdown's lib/schemas import.)
import { useNotificationsRealtime } from '@/modules/notifications/hooks/use-notifications-realtime';

// ---------------------------------------------------------------------------
// Mocks
//
// We mock the browser Supabase client and capture the `postgres_changes`
// handler + the binding config so we can simulate an incoming INSERT and assert
// the channel name, filter, event, and teardown.
// ---------------------------------------------------------------------------

let changesHandler: ((message: { new: unknown }) => void) | null = null;
let registeredBinding: { type: string; config: Record<string, unknown> } | null = null;

const mockRemoveChannel = vi.fn();
const mockSubscribe = vi.fn();
const mockChannelFactory = vi.fn();

function makeChannel() {
  const channel = {
    on: vi.fn(
      (type: string, config: Record<string, unknown>, handler: (m: { new: unknown }) => void) => {
        registeredBinding = { type, config };
        changesHandler = handler;
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
    channel: (name: string) => ReturnType<typeof makeChannel>;
    removeChannel: (channel: unknown) => void;
  } => ({
    channel: (name: string) => {
      mockChannelFactory(name);
      return makeChannel();
    },
    removeChannel: (channel: unknown): void => {
      mockRemoveChannel(channel);
    },
  }),
}));

const USER_ID = '11111111-1111-1111-1111-111111111111';

describe('useNotificationsRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    changesHandler = null;
    registeredBinding = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to the per-user channel with an owner-filtered postgres_changes INSERT binding', () => {
    renderHook(() => useNotificationsRealtime(USER_ID, vi.fn()));

    expect(mockChannelFactory).toHaveBeenCalledWith(`notifications:${USER_ID}`);
    expect(registeredBinding).toEqual({
      type: 'postgres_changes',
      config: {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${USER_ID}`,
      },
    });
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe when userId is null', () => {
    renderHook(() => useNotificationsRealtime(null, vi.fn()));

    expect(mockChannelFactory).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('does not subscribe when userId is undefined', () => {
    renderHook(() => useNotificationsRealtime(undefined, vi.fn()));

    expect(mockChannelFactory).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('invokes onInsert for each delivered INSERT event', () => {
    const onInsert = vi.fn();
    renderHook(() => useNotificationsRealtime(USER_ID, onInsert));

    expect(changesHandler).not.toBeNull();
    changesHandler?.({ new: { id: 'n1' } });
    changesHandler?.({ new: { id: 'n2' } });

    expect(onInsert).toHaveBeenCalledTimes(2);
  });

  it('does not invoke onInsert before any event arrives', () => {
    const onInsert = vi.fn();
    renderHook(() => useNotificationsRealtime(USER_ID, onInsert));

    expect(onInsert).not.toHaveBeenCalled();
  });

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useNotificationsRealtime(USER_ID, vi.fn()));

    unmount();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });

  it('resubscribes when userId changes (teardown + new channel)', () => {
    const newUserId = '22222222-2222-2222-2222-222222222222';
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useNotificationsRealtime(id, vi.fn()),
      { initialProps: { id: USER_ID } },
    );

    rerender({ id: newUserId });

    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(mockChannelFactory).toHaveBeenCalledWith(`notifications:${newUserId}`);
  });
});
