import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  processRecordingCleanup,
  type RecordingCleanupDeps,
} from '@/modules/telepsicologia/inngest/recording-cleanup';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRecordings } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(): RecordingCleanupDeps {
  const { db } = openClient();
  return { db };
}

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

/**
 * Seeds a video_recording row with the given status and recorded_at.
 * Returns the recording ID.
 */
async function seedVideoRecording(
  userId: string,
  sessionId: string,
  opts: {
    status: string;
    recordedAt: Date;
    audioTempUrl?: string | null;
  },
): Promise<string> {
  const recordingId = randomUUID();
  await runAsService(async (db) => {
    // Use raw SQL to set recorded_at precisely (bypass column defaults)
    await db.execute(
      dsql`INSERT INTO video_recordings (id, session_id, user_id, status, recorded_at, audio_temp_url)
           VALUES (
             ${recordingId},
             ${sessionId},
             ${userId},
             ${opts.status},
             ${opts.recordedAt.toISOString()}::timestamptz,
             ${opts.audioTempUrl ?? null}
           )`,
    );
  });
  return recordingId;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  // No mocks needed — pure DB operation
});

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recording-cleanup cron', () => {
  it('discards a recording older than 24h with status "processing"', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'processing',
      recordedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
      audioTempUrl: 'https://example.com/audio.mp3',
    });

    const deps = makeDeps();
    const result = await processRecordingCleanup(deps);

    expect(result.discardedCount).toBe(1);

    // Verify the recording was updated correctly
    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]!.status).toBe('discarded');
    expect(recordings[0]!.audioTempUrl).toBeNull();
    expect(recordings[0]!.discardedAt).not.toBeNull();
  });

  it('discards a recording older than 24h with status "transcribed"', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'transcribed',
      recordedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
      audioTempUrl: 'https://example.com/audio2.mp3',
    });

    const deps = makeDeps();
    const result = await processRecordingCleanup(deps);

    expect(result.discardedCount).toBe(1);

    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings[0]!.status).toBe('discarded');
    expect(recordings[0]!.audioTempUrl).toBeNull();
    expect(recordings[0]!.discardedAt).not.toBeNull();
  });

  it('skips a recording younger than 24h', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'processing',
      recordedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
      audioTempUrl: 'https://example.com/audio-recent.mp3',
    });

    const deps = makeDeps();
    const result = await processRecordingCleanup(deps);

    expect(result.discardedCount).toBe(0);

    // Verify the recording is unchanged
    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings[0]!.status).toBe('processing');
    expect(recordings[0]!.audioTempUrl).toBe('https://example.com/audio-recent.mp3');
    expect(recordings[0]!.discardedAt).toBeNull();
  });

  it('skips a recording with status "idle"', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'idle',
      recordedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48 hours ago
      audioTempUrl: null,
    });

    const deps = makeDeps();
    const result = await processRecordingCleanup(deps);

    expect(result.discardedCount).toBe(0);

    // Verify the recording is unchanged
    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings[0]!.status).toBe('idle');
  });

  it('sets audio_temp_url to null on discarded recording', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'processing',
      recordedAt: new Date(Date.now() - 30 * 60 * 60 * 1000), // 30 hours ago
      audioTempUrl: 'https://stream.io/recordings/abc123.wav',
    });

    const deps = makeDeps();
    await processRecordingCleanup(deps);

    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings[0]!.audioTempUrl).toBeNull();
  });

  it('returns zero when no recordings qualify', async () => {
    const deps = makeDeps();
    const result = await processRecordingCleanup(deps);

    expect(result.discardedCount).toBe(0);
  });

  it('discards multiple qualifying recordings in a single run', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId1 = randomUUID();
    const sessionId2 = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId1, patientId);
    await seedSession(userId, sessionId2, patientId);

    await seedVideoRecording(userId, sessionId1, {
      status: 'processing',
      recordedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      audioTempUrl: 'https://example.com/audio1.mp3',
    });

    await seedVideoRecording(userId, sessionId2, {
      status: 'transcribed',
      recordedAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      audioTempUrl: 'https://example.com/audio2.mp3',
    });

    const deps = makeDeps();
    const result = await processRecordingCleanup(deps);

    expect(result.discardedCount).toBe(2);
  });

  it('skips recordings with status "recording" even if older than 24h', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'recording',
      recordedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      audioTempUrl: 'https://example.com/live.mp3',
    });

    const deps = makeDeps();
    const result = await processRecordingCleanup(deps);

    expect(result.discardedCount).toBe(0);

    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings[0]!.status).toBe('recording');
  });

  it('skips already-discarded recordings', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const recordingId = await seedVideoRecording(userId, sessionId, {
      status: 'discarded',
      recordedAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      audioTempUrl: null,
    });

    const deps = makeDeps();
    const result = await processRecordingCleanup(deps);

    expect(result.discardedCount).toBe(0);

    const recordings = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.id, recordingId));
    });
    expect(recordings[0]!.status).toBe('discarded');
  });
});
