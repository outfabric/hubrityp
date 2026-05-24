import { randomUUID } from 'node:crypto';

import type { StreamClient } from '@stream-io/node-sdk';
import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionCreatedEvent, SessionUpdatedEvent } from '@/modules/agenda/lib/session-events';
import {
  processSessionCreated,
  processSessionUpdated,
  type AutoCreateRoomDeps,
} from '@/modules/telepsicologia/inngest/auto-create-room';
import { createVideoRoomHelper } from '@/modules/telepsicologia/server/create-video-room-helper';
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

const mockStreamClient = {
  video: {
    call: () => ({
      getOrCreate: mockGetOrCreate,
    }),
  },
  generateCallToken: mockGenerateCallToken,
};

vi.mock('@/modules/telepsicologia/server/stream-client', () => ({
  getStreamClient: () => mockStreamClient,
}));

// ---------------------------------------------------------------------------
// Deps factory — uses real DB, mocked Stream
// ---------------------------------------------------------------------------

function makeDeps(): AutoCreateRoomDeps {
  const { db } = openClient();
  return {
    db,
    getStreamClient: () => mockStreamClient as unknown as StreamClient,
    createVideoRoomHelper,
  };
}

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

async function seedPatient(
  userId: string,
  patientId: string,
  opts?: { patientType?: string },
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      patientType: opts?.patientType ?? 'individual',
    });
  });
}

async function seedSession(
  userId: string,
  sessionId: string,
  patientId: string,
  opts?: { modality?: string; status?: string },
): Promise<void> {
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
      modality: opts?.modality ?? 'online',
      status: opts?.status ?? 'scheduled',
    });
  });
}

function makeCreatedEvent(overrides: Partial<SessionCreatedEvent> = {}): SessionCreatedEvent {
  return {
    sessionId: randomUUID(),
    userId: randomUUID(),
    patientId: randomUUID(),
    modality: 'online',
    status: 'scheduled',
    startAt: new Date(),
    endAt: new Date(Date.now() + 3600_000),
    ...overrides,
  };
}

function makeUpdatedEvent(overrides: Partial<SessionUpdatedEvent> = {}): SessionUpdatedEvent {
  return {
    sessionId: randomUUID(),
    userId: randomUUID(),
    patientId: randomUUID(),
    modality: 'online',
    status: 'scheduled',
    startAt: new Date(),
    endAt: new Date(Date.now() + 3600_000),
    ...overrides,
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
// Tests — processSessionCreated
// ---------------------------------------------------------------------------

describe('auto-create-room: processSessionCreated', () => {
  it('creates a video room for an online scheduled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const deps = makeDeps();
    const event = makeCreatedEvent({ sessionId, userId, patientId });

    const result = await processSessionCreated(event, deps);

    expect(result.action).toBe('created');
    if (result.action !== 'created') return;

    // Verify the room was persisted in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.streamCallId).toBe(`session-${sessionId}`);

    // Verify Stream SDK was called
    expect(mockGetOrCreate).toHaveBeenCalledOnce();
    expect(mockGenerateCallToken).toHaveBeenCalledOnce();
  });

  it('creates a room for a confirmed session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId, { status: 'confirmed' });

    const deps = makeDeps();
    const event = makeCreatedEvent({
      sessionId,
      userId,
      patientId,
      status: 'confirmed',
    });

    const result = await processSessionCreated(event, deps);

    expect(result.action).toBe('created');
  });

  it('skips non-online sessions', async () => {
    const deps = makeDeps();
    const event = makeCreatedEvent({ modality: 'in_person' });

    const result = await processSessionCreated(event, deps);

    expect(result.action).toBe('skipped');
    if (result.action !== 'skipped') return;
    expect(result.reason).toBe('not_online');

    // Stream SDK NOT called
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });

  it('skips cancelled sessions', async () => {
    const deps = makeDeps();
    const event = makeCreatedEvent({ status: 'cancelled' });

    const result = await processSessionCreated(event, deps);

    expect(result.action).toBe('skipped');
    if (result.action !== 'skipped') return;
    expect(result.reason).toBe('not_schedulable');
  });

  it('skips done sessions', async () => {
    const deps = makeDeps();
    const event = makeCreatedEvent({ status: 'done' });

    const result = await processSessionCreated(event, deps);

    expect(result.action).toBe('skipped');
    if (result.action !== 'skipped') return;
    expect(result.reason).toBe('not_schedulable');
  });

  it('does not duplicate room for same session (idempotent)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const deps = makeDeps();
    const event = makeCreatedEvent({ sessionId, userId, patientId });

    // First call creates the room
    const result1 = await processSessionCreated(event, deps);
    expect(result1.action).toBe('created');

    // Reset mocks
    vi.clearAllMocks();

    // Second call — room already exists, helper returns it idempotently
    const result2 = await processSessionCreated(event, deps);
    expect(result2.action).toBe('created');

    // Only one row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(rows).toHaveLength(1);

    // Stream SDK NOT called on second invocation (idempotent helper
    // returns early when it finds an existing room)
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — processSessionUpdated
// ---------------------------------------------------------------------------

describe('auto-create-room: processSessionUpdated', () => {
  it('creates a room when session is updated and still online', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const deps = makeDeps();
    const event = makeUpdatedEvent({
      sessionId,
      userId,
      patientId,
      modality: 'online',
      status: 'scheduled',
    });

    const result = await processSessionUpdated(event, deps);

    expect(result.action).toBe('created');

    // Verify DB
    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(rows).toHaveLength(1);
  });

  it('expires room when session changed from online to in_person', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    // First, create the room
    const deps = makeDeps();
    const createEvent = makeCreatedEvent({ sessionId, userId, patientId });
    await processSessionCreated(createEvent, deps);

    // Verify room exists with status 'pending'
    const before = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(before).toHaveLength(1);
    expect(before[0]!.status).toBe('pending');

    vi.clearAllMocks();

    // Now update the session from online to in_person
    const updateEvent = makeUpdatedEvent({
      sessionId,
      userId,
      patientId,
      modality: 'in_person',
      previousModality: 'online',
    });

    const result = await processSessionUpdated(updateEvent, deps);

    expect(result.action).toBe('expired_room');

    // Verify room status is 'expired'
    const after = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('expired');
  });

  it('skips when switching from online to in_person but no room exists', async () => {
    const deps = makeDeps();
    const event = makeUpdatedEvent({
      modality: 'in_person',
      previousModality: 'online',
    });

    const result = await processSessionUpdated(event, deps);

    expect(result.action).toBe('skipped');
    if (result.action !== 'skipped') return;
    expect(result.reason).toBe('no_room_to_expire');
  });

  it('skips non-online sessions', async () => {
    const deps = makeDeps();
    const event = makeUpdatedEvent({ modality: 'in_person' });

    const result = await processSessionUpdated(event, deps);

    expect(result.action).toBe('skipped');
    if (result.action !== 'skipped') return;
    expect(result.reason).toBe('not_online');
  });

  it('skips cancelled sessions', async () => {
    const deps = makeDeps();
    const event = makeUpdatedEvent({ status: 'cancelled' });

    const result = await processSessionUpdated(event, deps);

    expect(result.action).toBe('skipped');
    if (result.action !== 'skipped') return;
    expect(result.reason).toBe('not_schedulable');
  });

  it('does not create duplicate room when session updated but room exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const deps = makeDeps();

    // Create room via session.created
    const createEvent = makeCreatedEvent({ sessionId, userId, patientId });
    await processSessionCreated(createEvent, deps);

    vi.clearAllMocks();

    // Update event for the same online session — room already exists
    const updateEvent = makeUpdatedEvent({
      sessionId,
      userId,
      patientId,
      modality: 'online',
      status: 'confirmed',
    });
    const result = await processSessionUpdated(updateEvent, deps);

    expect(result.action).toBe('created');

    // Only one row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.sessionId, sessionId));
    });
    expect(rows).toHaveLength(1);

    // Stream SDK NOT called — helper returned existing room
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });
});
