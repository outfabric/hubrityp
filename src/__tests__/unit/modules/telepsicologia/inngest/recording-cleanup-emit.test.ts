/**
 * Unit tests for the `emitReadyRecordings` function in recording-cleanup.ts.
 *
 * Verifies:
 *   - Event dispatched once per terminal transition (processing + audioTempUrl set).
 *   - Not dispatched on retries after dispatch (audioTempUrl cleared).
 *   - Emit failure does not break cleanup (fire-and-forget).
 *   - No emit when sender is not provided.
 *   - Skips recordings with missing join data (no patientId, no streamCallId).
 */

import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_TRANSCRIPTION_EVENTS } from '@/modules/ai-transcription/inngest/events';
import {
  emitReadyRecordings,
  type InngestSender,
  type RecordingCleanupDeps,
} from '@/modules/telepsicologia/inngest/recording-cleanup';

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------

/**
 * Row shape returned by the SELECT...JOIN in emitReadyRecordings.
 */
interface ReadyRecordingRow {
  recordingId: string;
  userId: string;
  sessionId: string;
  audioTempUrl: string | null;
  patientId: string | null;
  streamCallId: string;
}

/**
 * Creates a mock Drizzle DB that returns the given rows from the select query
 * and tracks update calls.
 */
function makeMockDb(rows: ReadyRecordingRow[]) {
  const updatedIds: string[] = [];

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          // Track that an update was called. The actual WHERE clause uses
          // eq(videoRecordings.id, rec.recordingId) — in the mock we just count.
          updatedIds.push('updated');
          return Promise.resolve();
        }),
      }),
    }),
    _updatedIds: updatedIds,
  };

  return mockDb;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeReadyRow(overrides?: Partial<ReadyRecordingRow>): ReadyRecordingRow {
  return {
    recordingId: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    audioTempUrl:
      'https://us-east.stream-io-cdn.com/recordings/default/call123/session456/rec.webm',
    patientId: randomUUID(),
    streamCallId: `call-${randomUUID()}`,
    ...overrides,
  };
}

function makeSender(): InngestSender & { calls: Array<{ name: string; data: unknown }> } {
  const calls: Array<{ name: string; data: unknown }> = [];
  return {
    calls,
    send: vi.fn().mockImplementation((payload: { name: string; data: unknown }) => {
      calls.push(payload);
      return Promise.resolve({ ids: [randomUUID()] });
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitReadyRecordings', () => {
  let sender: ReturnType<typeof makeSender>;

  beforeEach(() => {
    sender = makeSender();
  });

  it('dispatches recording.completed once per ready recording', async () => {
    const row = makeReadyRow();
    const db = makeMockDb([row]);

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      sender,
    });

    expect(result.emittedCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.name).toBe(AI_TRANSCRIPTION_EVENTS.RECORDING_COMPLETED);

    const data = sender.calls[0]!.data as Record<string, unknown>;
    expect(data.userId).toBe(row.userId);
    expect(data.patientId).toBe(row.patientId);
    expect(data.sessionId).toBe(row.sessionId);
    expect(data.streamRecordingUrl).toBe(row.audioTempUrl);
    expect(data.streamCallId).toBe(row.streamCallId);

    // audioTempUrl should be cleared (update called)
    expect(db.update).toHaveBeenCalled();
  });

  it('dispatches for multiple ready recordings', async () => {
    const rows = [makeReadyRow(), makeReadyRow(), makeReadyRow()];
    const db = makeMockDb(rows);

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      sender,
    });

    expect(result.emittedCount).toBe(3);
    expect(result.errorCount).toBe(0);
    expect(sender.calls).toHaveLength(3);
  });

  it('does not dispatch when no recordings are ready', async () => {
    const db = makeMockDb([]);

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      sender,
    });

    expect(result.emittedCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });

  it('does not dispatch when sender is not provided', async () => {
    const db = makeMockDb([makeReadyRow()]);

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      // No sender
    });

    expect(result.emittedCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it('skips rows with null patientId (blocking slot edge case)', async () => {
    const row = makeReadyRow({ patientId: null });
    const db = makeMockDb([row]);

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      sender,
    });

    expect(result.emittedCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });

  it('skips rows with null audioTempUrl', async () => {
    const row = makeReadyRow({ audioTempUrl: null });
    const db = makeMockDb([row]);

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      sender,
    });

    expect(result.emittedCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });

  it('emit failure does not break the loop — remaining recordings still process', async () => {
    const row1 = makeReadyRow();
    const row2 = makeReadyRow();
    const row3 = makeReadyRow();
    const db = makeMockDb([row1, row2, row3]);

    // Fail on the second send call
    let callCount = 0;
    sender.send = vi.fn().mockImplementation((payload: { name: string; data: unknown }) => {
      callCount++;
      if (callCount === 2) {
        return Promise.reject(new Error('Inngest send transient failure'));
      }
      sender.calls.push(payload);
      return Promise.resolve({ ids: [randomUUID()] });
    });

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      sender,
    });

    // 2 succeeded, 1 failed
    expect(result.emittedCount).toBe(2);
    expect(result.errorCount).toBe(1);
    // All 3 were attempted
    expect(sender.send).toHaveBeenCalledTimes(3);
  });

  it('emit failure does not clear audioTempUrl — row retries on next cron run', async () => {
    const row = makeReadyRow();
    const db = makeMockDb([row]);

    sender.send = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      sender,
    });

    expect(result.emittedCount).toBe(0);
    expect(result.errorCount).toBe(1);
    // update (clearing audioTempUrl) should NOT have been called
    expect(db.update).not.toHaveBeenCalled();
  });

  it('validates payload with Zod before sending — rejects malformed data', async () => {
    // Row with invalid URL (not a URL format)
    const row = makeReadyRow({ audioTempUrl: 'not-a-valid-url' });
    const db = makeMockDb([row]);

    const result = await emitReadyRecordings({
      db: db as unknown as RecordingCleanupDeps['db'],
      sender,
    });

    // Zod validation should fail, caught by try/catch
    expect(result.emittedCount).toBe(0);
    expect(result.errorCount).toBe(1);
    // send should not have been called (validation failed before send)
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('idempotency: second call with same rows returns 0 if audioTempUrl was cleared', async () => {
    // Simulate: first call processes the rows (audioTempUrl set)
    const row = makeReadyRow();
    const db1 = makeMockDb([row]);

    const result1 = await emitReadyRecordings({
      db: db1 as unknown as RecordingCleanupDeps['db'],
      sender,
    });
    expect(result1.emittedCount).toBe(1);

    // Simulate: second call — DB returns empty because audioTempUrl IS NULL
    // (the WHERE clause filters it out).
    const db2 = makeMockDb([]);

    const result2 = await emitReadyRecordings({
      db: db2 as unknown as RecordingCleanupDeps['db'],
      sender,
    });
    expect(result2.emittedCount).toBe(0);
  });
});
