/**
 * Integration test for the Stream recording-settings fix (task 6.1).
 *
 * Exercises `createVideoRoomHelper` against a real Postgres (Testcontainers +
 * Drizzle migrations + RLS) with a mocked Stream client. The regression this
 * guards against: the auto-created room must request server-side recording with
 * the correct settings so a session can be recorded on demand.
 *
 * It verifies that:
 *   - The Stream call is created with `recording: { mode: 'available',
 *     quality: '1080p', audio_only: false }`.
 *   - A `video_rooms` row is persisted with status 'pending'.
 *
 * `createVideoRoomHelper` is pure business logic (it neither authenticates nor
 * authorizes), so we call it directly with a hand-built Stream mock and the
 * real DB client — no module-level vi.mock is required.
 */

import { randomUUID } from 'node:crypto';

import type { StreamClient } from '@stream-io/node-sdk';
import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createVideoRoomHelper,
  type SessionData,
} from '@/modules/telepsicologia/server/create-video-room-helper';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Stream SDK — no real network calls
// ---------------------------------------------------------------------------

const mockGetOrCreate = vi.fn().mockResolvedValue({ call: { cid: 'default:mock-call' } });
const mockGenerateCallToken = vi.fn().mockReturnValue('mock-patient-jwt-token');

const mockUpsertUsers = vi.fn().mockResolvedValue({});

function makeStreamClient(): StreamClient {
  return {
    upsertUsers: mockUpsertUsers,
    video: {
      call: () => ({
        getOrCreate: mockGetOrCreate,
      }),
    },
    generateCallToken: mockGenerateCallToken,
  } as unknown as StreamClient;
}

// ---------------------------------------------------------------------------
// Seed helpers
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
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: new Date(now.getTime() + 3600_000),
      durationMinutes: 50,
      modality: 'online',
      status: 'scheduled',
    });
  });
}

function makeSessionData(userId: string, sessionId: string, patientId: string): SessionData {
  const now = new Date();
  return {
    id: sessionId,
    userId,
    patientId,
    startAt: now,
    endAt: new Date(now.getTime() + 3600_000),
    psychologistName: 'Dr. Ana Souza',
    patientFullName: 'Test Patient',
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createVideoRoomHelper: Stream recording settings', () => {
  it('creates the Stream call with recording mode=available, quality=1080p, audio_only=false', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const { db } = openClient();
    const result = await createVideoRoomHelper(
      makeStreamClient(),
      makeSessionData(userId, sessionId, patientId),
      db,
    );

    expect(result.ok).toBe(true);

    // Verify the recording settings handed to Stream.
    expect(mockGetOrCreate).toHaveBeenCalledOnce();
    const createCallArgs = mockGetOrCreate.mock.calls[0]![0] as {
      data: {
        settings_override: {
          recording: { mode: string; quality: string; audio_only: boolean };
        };
      };
    };
    expect(createCallArgs.data.settings_override.recording).toEqual({
      mode: 'available',
      quality: '1080p',
      audio_only: false,
    });
  });

  it('persists a video_rooms row with status pending', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const { db } = openClient();
    const result = await createVideoRoomHelper(
      makeStreamClient(),
      makeSessionData(userId, sessionId, patientId),
      db,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.status).toBe('pending');
    expect(result.room.streamCallId).toBe(`session-${sessionId}`);

    const rows = await runAsService(async (svc) =>
      svc.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.status).toBe('pending');
  });
});
