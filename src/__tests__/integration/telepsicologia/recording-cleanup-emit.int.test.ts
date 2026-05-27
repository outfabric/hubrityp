/**
 * Integration tests for `emitReadyRecordings` in recording-cleanup.ts.
 *
 * Verifies against real Postgres (Testcontainers) that:
 *   - The function correctly joins video_recordings + sessions + video_rooms.
 *   - Events are dispatched for qualifying recordings.
 *   - audioTempUrl is cleared after dispatch (idempotency).
 *   - Recordings without audioTempUrl are skipped.
 *   - The inngest.send call receives a correctly validated payload.
 */

import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_TRANSCRIPTION_EVENTS } from '@/modules/ai-transcription/inngest/events';
import {
  emitReadyRecordings,
  type InngestSender,
} from '@/modules/telepsicologia/inngest/recording-cleanup';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRecordings, videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: 'individual',
    });
  });
}

async function seedSession(userId: string, sessionId: string, patientId: string): Promise<void> {
  const now = new Date();
  const later = new Date(now.getTime() + 3600_000);
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: later,
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });
  });
}

async function seedVideoRoom(
  userId: string,
  sessionId: string,
  streamCallId: string,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(videoRooms).values({
      id: randomUUID(),
      userId,
      sessionId,
      streamCallId,
      patientToken: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      patientJwt: 'mock-patient-jwt',
      availableFrom: new Date(Date.now() - 600_000),
      expiresAt: new Date(Date.now() + 7200_000),
      status: 'active',
    });
  });
}

async function seedVideoRecording(
  userId: string,
  sessionId: string,
  opts: {
    status: string;
    audioTempUrl?: string | null;
    recordedAt?: Date;
  },
): Promise<string> {
  const recordingId = randomUUID();
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO video_recordings (id, session_id, user_id, status, audio_temp_url, recorded_at)
           VALUES (
             ${recordingId},
             ${sessionId},
             ${userId},
             ${opts.status},
             ${opts.audioTempUrl ?? null},
             ${(opts.recordedAt ?? new Date()).toISOString()}::timestamptz
           )`,
    );
  });
  return recordingId;
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
// Lifecycle
// ---------------------------------------------------------------------------

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitReadyRecordings (integration)', () => {
  it('dispatches recording.completed for a processing recording with audioTempUrl', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const streamCallId = `call-${randomUUID()}`;
    const streamUrl = 'https://us-east.stream-io-cdn.com/recordings/default/call123/s1/rec.webm';

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    await seedVideoRoom(userId, sessionId, streamCallId);
    await seedVideoRecording(userId, sessionId, {
      status: 'processing',
      audioTempUrl: streamUrl,
    });

    const sender = makeSender();
    const { db } = openClient();

    const result = await emitReadyRecordings({ db, sender });

    expect(result.emittedCount).toBe(1);
    expect(result.errorCount).toBe(0);

    // Verify event payload
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.name).toBe(AI_TRANSCRIPTION_EVENTS.RECORDING_COMPLETED);

    const data = sender.calls[0]!.data as Record<string, unknown>;
    expect(data.userId).toBe(userId);
    expect(data.patientId).toBe(patientId);
    expect(data.sessionId).toBe(sessionId);
    expect(data.streamRecordingUrl).toBe(streamUrl);
    expect(data.streamCallId).toBe(streamCallId);
  });

  it('clears audioTempUrl after successful dispatch (idempotency)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const streamCallId = `call-${randomUUID()}`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    await seedVideoRoom(userId, sessionId, streamCallId);
    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'processing',
      audioTempUrl: 'https://stream-io-cdn.com/recordings/default/c1/s1/rec.webm',
    });

    const sender = makeSender();
    const { db } = openClient();

    await emitReadyRecordings({ db, sender });

    // Verify audioTempUrl is now null in the DB
    const recordings = await runAsService(async (svcDb) => {
      return svcDb.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]!.audioTempUrl).toBeNull();
    // Status stays processing (not changed by emit)
    expect(recordings[0]!.status).toBe('processing');
  });

  it('second run does not re-dispatch (audioTempUrl cleared)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const streamCallId = `call-${randomUUID()}`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    await seedVideoRoom(userId, sessionId, streamCallId);
    await seedVideoRecording(userId, sessionId, {
      status: 'processing',
      audioTempUrl: 'https://stream-io-cdn.com/recordings/default/c1/s1/rec.webm',
    });

    const sender = makeSender();
    const { db } = openClient();

    // First run — emits
    const result1 = await emitReadyRecordings({ db, sender });
    expect(result1.emittedCount).toBe(1);

    // Second run — skips (audioTempUrl is null)
    const result2 = await emitReadyRecordings({ db, sender });
    expect(result2.emittedCount).toBe(0);

    // Only 1 event was sent total
    expect(sender.calls).toHaveLength(1);
  });

  it('skips recordings without audioTempUrl', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const streamCallId = `call-${randomUUID()}`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    await seedVideoRoom(userId, sessionId, streamCallId);
    await seedVideoRecording(userId, sessionId, {
      status: 'processing',
      audioTempUrl: null,
    });

    const sender = makeSender();
    const { db } = openClient();

    const result = await emitReadyRecordings({ db, sender });

    expect(result.emittedCount).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });

  it('skips recordings in non-processing status', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const streamCallId = `call-${randomUUID()}`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    await seedVideoRoom(userId, sessionId, streamCallId);
    // recording status, idle, transcribed — none should trigger emit
    await seedVideoRecording(userId, sessionId, {
      status: 'recording',
      audioTempUrl: 'https://stream-io-cdn.com/recordings/default/c1/s1/rec.webm',
    });

    const sender = makeSender();
    const { db } = openClient();

    const result = await emitReadyRecordings({ db, sender });

    expect(result.emittedCount).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });

  it('emit failure does not clear audioTempUrl — retries next run', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const streamCallId = `call-${randomUUID()}`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);
    await seedVideoRoom(userId, sessionId, streamCallId);
    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'processing',
      audioTempUrl: 'https://stream-io-cdn.com/recordings/default/c1/s1/rec.webm',
    });

    const failingSender: InngestSender = {
      send: vi.fn().mockRejectedValue(new Error('Inngest send failure')),
    };
    const { db } = openClient();

    const result = await emitReadyRecordings({ db, sender: failingSender });

    expect(result.emittedCount).toBe(0);
    expect(result.errorCount).toBe(1);

    // audioTempUrl should still be set (not cleared on failure)
    const recordings = await runAsService(async (svcDb) => {
      return svcDb.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings[0]!.audioTempUrl).toBe(
      'https://stream-io-cdn.com/recordings/default/c1/s1/rec.webm',
    );

    // Next run should try again (audioTempUrl is still set)
    const successSender = makeSender();
    const result2 = await emitReadyRecordings({ db, sender: successSender });
    expect(result2.emittedCount).toBe(1);
  });

  it('handles multiple recordings — emits for each', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId1 = randomUUID();
    const sessionId2 = randomUUID();
    const streamCallId1 = `call-${randomUUID()}`;
    const streamCallId2 = `call-${randomUUID()}`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId1, patientId);
    await seedSession(userId, sessionId2, patientId);
    await seedVideoRoom(userId, sessionId1, streamCallId1);
    await seedVideoRoom(userId, sessionId2, streamCallId2);
    await seedVideoRecording(userId, sessionId1, {
      status: 'processing',
      audioTempUrl: 'https://stream-io-cdn.com/recordings/default/c1/s1/rec1.webm',
    });
    await seedVideoRecording(userId, sessionId2, {
      status: 'processing',
      audioTempUrl: 'https://stream-io-cdn.com/recordings/default/c2/s2/rec2.webm',
    });

    const sender = makeSender();
    const { db } = openClient();

    const result = await emitReadyRecordings({ db, sender });

    expect(result.emittedCount).toBe(2);
    expect(sender.calls).toHaveLength(2);

    // Verify both events have distinct payloads
    const sessionIds = sender.calls.map((c) => (c.data as Record<string, unknown>).sessionId);
    expect(sessionIds).toContain(sessionId1);
    expect(sessionIds).toContain(sessionId2);
  });
});
