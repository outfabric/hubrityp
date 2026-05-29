// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractTranscriptionId,
  useAiTranscriptionRealtime,
} from '@/modules/ai-transcription/hooks/use-ai-transcription-realtime';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

const mockToast = vi.fn();
vi.mock('sonner', () => ({
  toast: (...args: unknown[]): void => {
    mockToast(...args);
  },
}));

// Captures the broadcast handler registered via `.on('broadcast', ...)` so the
// test can simulate an incoming `ready` event.
let broadcastHandler: ((message: { payload: unknown }) => void) | null = null;
let registeredEvent: { type: string; filter: { event: string } } | null = null;

const mockRemoveChannel = vi.fn();
const mockSubscribe = vi.fn();

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

const mockChannelFactory = vi.fn();
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapperWith(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const USER_ID = '11111111-1111-1111-1111-111111111111';
const TRANSCRIPTION_ID = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAiTranscriptionRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broadcastHandler = null;
    registeredEvent = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to the per-user channel with the ready broadcast event', () => {
    const queryClient = new QueryClient();
    renderHook(() => useAiTranscriptionRealtime(USER_ID), { wrapper: wrapperWith(queryClient) });

    expect(mockChannelFactory).toHaveBeenCalledWith(`user:${USER_ID}`);
    expect(registeredEvent).toEqual({
      type: 'broadcast',
      filter: { event: 'ai-transcription:ready' },
    });
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe when userId is null', () => {
    const queryClient = new QueryClient();
    renderHook(() => useAiTranscriptionRealtime(null), { wrapper: wrapperWith(queryClient) });

    expect(mockChannelFactory).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('invalidates the list and ready-count query keys on a ready event', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useAiTranscriptionRealtime(USER_ID), { wrapper: wrapperWith(queryClient) });

    expect(broadcastHandler).not.toBeNull();
    broadcastHandler?.({ payload: { transcriptionId: TRANSCRIPTION_ID } });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ai-transcriptions', 'list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['ai-transcriptions', 'ready-count'] });
  });

  it('fires a Sonner toast with a "Ver" action linking to the review page', () => {
    const queryClient = new QueryClient();
    renderHook(() => useAiTranscriptionRealtime(USER_ID), { wrapper: wrapperWith(queryClient) });

    broadcastHandler?.({ payload: { transcriptionId: TRANSCRIPTION_ID } });

    expect(mockToast).toHaveBeenCalledTimes(1);
    const [title, options] = mockToast.mock.calls[0] as [
      string,
      { action?: { label: string; onClick: () => void } },
    ];
    expect(title).toBe('Nova nota IA pronta para revisão');
    expect(options.action?.label).toBe('Ver');

    options.action?.onClick();
    expect(mockRouterPush).toHaveBeenCalledWith(
      `/dashboard/transcricoes/${TRANSCRIPTION_ID}/revisar`,
    );
  });

  it('fires a toast without an action when the payload has no transcriptionId', () => {
    const queryClient = new QueryClient();
    renderHook(() => useAiTranscriptionRealtime(USER_ID), { wrapper: wrapperWith(queryClient) });

    broadcastHandler?.({ payload: {} });

    expect(mockToast).toHaveBeenCalledTimes(1);
    const [, options] = mockToast.mock.calls[0] as [string, { action?: unknown }];
    expect(options.action).toBeUndefined();
  });

  it('removes the channel on unmount', () => {
    const queryClient = new QueryClient();
    const { unmount } = renderHook(() => useAiTranscriptionRealtime(USER_ID), {
      wrapper: wrapperWith(queryClient),
    });

    unmount();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });
});

describe('extractTranscriptionId', () => {
  it('returns null for an empty object', () => {
    expect(extractTranscriptionId({})).toBeNull();
  });

  it('returns null when the transcriptionId field is missing', () => {
    expect(extractTranscriptionId({ other: 'value' })).toBeNull();
  });

  it('returns null when transcriptionId is a non-string value', () => {
    expect(extractTranscriptionId({ transcriptionId: 123 })).toBeNull();
    expect(extractTranscriptionId({ transcriptionId: { nested: true } })).toBeNull();
    expect(extractTranscriptionId({ transcriptionId: ['array'] })).toBeNull();
  });

  it('returns null for null and non-object payloads', () => {
    expect(extractTranscriptionId(null)).toBeNull();
    expect(extractTranscriptionId(undefined)).toBeNull();
    expect(extractTranscriptionId('not-an-object')).toBeNull();
    expect(extractTranscriptionId(42)).toBeNull();
  });

  it('returns null for an empty string transcriptionId', () => {
    expect(extractTranscriptionId({ transcriptionId: '' })).toBeNull();
  });

  it('returns the value for a valid UUID transcriptionId', () => {
    expect(extractTranscriptionId({ transcriptionId: TRANSCRIPTION_ID })).toBe(TRANSCRIPTION_ID);
  });
});
