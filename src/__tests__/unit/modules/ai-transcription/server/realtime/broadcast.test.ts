/**
 * Unit tests for broadcastAiReady — the Supabase Realtime broadcast that
 * notifies the client UI when an AI transcription is ready.
 *
 * We mock `@supabase/supabase-js` and the logger to verify:
 *  1. The correct channel name is used (`user:<userId>`).
 *  2. A broadcast event `ai-transcription:ready` is sent with the transcriptionId.
 *  3. The channel is cleaned up after sending.
 *  4. Errors are swallowed (not thrown) — the function is best-effort.
 */

import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptionId } from '@/modules/ai-transcription/lib/branded-types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSend = vi.fn();
const mockRemoveChannel = vi.fn();
const mockChannel = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  })),
}));

vi.mock('@/shared/env/client', () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  },
}));

// Suppress log output during tests — the logger is real but we do not
// want Pino JSON cluttering test output.
vi.mock('@/modules/ai-transcription/lib/logger', () => ({
  createTranscriptionLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('broadcastAiReady', () => {
  const userId = randomUUID();
  const transcriptionId = randomUUID() as TranscriptionId;
  const serviceRoleKey = 'test-service-role-key';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: channel().send resolves, removeChannel resolves.
    const channelObj = { send: mockSend };
    mockChannel.mockReturnValue(channelObj);
    mockSend.mockResolvedValue('ok');
    mockRemoveChannel.mockResolvedValue(undefined);
  });

  it('calls supabase.channel with "user:<userId>" and sends broadcast event', async () => {
    const { broadcastAiReady } =
      await import('@/modules/ai-transcription/server/realtime/broadcast');

    await broadcastAiReady({ userId, transcriptionId }, { serviceRoleKey });

    // Channel name must be scoped to the user.
    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockChannel).toHaveBeenCalledWith(`user:${userId}`);

    // Broadcast payload must include the transcription ID and correct event.
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'ai-transcription:ready',
      payload: { transcriptionId },
    });
  });

  it('removes the channel after sending', async () => {
    const { broadcastAiReady } =
      await import('@/modules/ai-transcription/server/realtime/broadcast');

    await broadcastAiReady({ userId, transcriptionId }, { serviceRoleKey });

    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    // The argument to removeChannel is the channel object returned by supabase.channel().
    const channelObj = mockChannel.mock.results[0]?.value;
    expect(mockRemoveChannel).toHaveBeenCalledWith(channelObj);
  });

  it('swallows errors from channel.send — does not throw', async () => {
    mockSend.mockRejectedValue(new Error('Realtime unavailable'));

    const { broadcastAiReady } =
      await import('@/modules/ai-transcription/server/realtime/broadcast');

    // Must not throw.
    await expect(
      broadcastAiReady({ userId, transcriptionId }, { serviceRoleKey }),
    ).resolves.toBeUndefined();
  });

  it('swallows errors from createClient — does not throw', async () => {
    // Simulate createClient itself throwing (e.g., invalid URL).
    const { createClient } = await import('@supabase/supabase-js');
    vi.mocked(createClient).mockImplementation(() => {
      throw new Error('Invalid Supabase URL');
    });

    const { broadcastAiReady } =
      await import('@/modules/ai-transcription/server/realtime/broadcast');

    await expect(
      broadcastAiReady({ userId, transcriptionId }, { serviceRoleKey }),
    ).resolves.toBeUndefined();
  });
});
