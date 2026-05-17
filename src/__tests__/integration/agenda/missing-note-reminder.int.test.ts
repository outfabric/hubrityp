import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { findSessionsMissingNotes } from '@/modules/agenda/server/missing-note-reminder';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
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

async function seedPatient(userId: string, patientId: string, name: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: name,
      patientType: 'individual',
    });
  });
}

/** Creates a session with the given status and updatedAt offset. */
async function createTestSession(
  userId: string,
  patientId: string,
  options: {
    status?: string;
    daysAgoUpdated?: number;
    deletedAt?: Date | null;
  } = {},
): Promise<string> {
  const { status = 'done', daysAgoUpdated = 10, deletedAt = null } = options;
  const sessionId = randomUUID();
  const startAt = new Date(Date.now() - (daysAgoUpdated + 1) * 24 * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 50 * 60 * 1000);
  const updatedAt = new Date(Date.now() - daysAgoUpdated * 24 * 60 * 60 * 1000);

  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt,
      endAt,
      durationMinutes: 50,
      status,
      updatedAt,
      deletedAt,
    });
  });

  return sessionId;
}

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// findSessionsMissingNotes
// =====================================================================

describe('findSessionsMissingNotes', () => {
  it('finds done sessions older than 7 days', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');

    const sessionId = await createTestSession(userId, patientId, {
      status: 'done',
      daysAgoUpdated: 10,
    });

    const result = await findSessionsMissingNotes();

    const found = result.sessionsFound.find((s) => s.sessionId === sessionId);
    expect(found).toBeDefined();
    expect(found!.patientId).toBe(patientId);
    expect(found!.userId).toBe(userId);
    expect(found!.daysSinceDone).toBeGreaterThanOrEqual(10);

    // Verify event payload
    const event = result.events.find((e) => e.sessionId === sessionId);
    expect(event).toBeDefined();
    expect(event!.patientId).toBe(patientId);
    expect(event!.userId).toBe(userId);
    expect(event!.daysSinceDone).toBeGreaterThanOrEqual(10);
  });

  it('does not find done sessions within 7 days', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Ana Costa');

    const sessionId = await createTestSession(userId, patientId, {
      status: 'done',
      daysAgoUpdated: 3,
    });

    const result = await findSessionsMissingNotes();

    const found = result.sessionsFound.find((s) => s.sessionId === sessionId);
    expect(found).toBeUndefined();
  });

  it('does not find cancelled sessions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');

    const sessionId = await createTestSession(userId, patientId, {
      status: 'cancelled',
      daysAgoUpdated: 10,
    });

    const result = await findSessionsMissingNotes();

    const found = result.sessionsFound.find((s) => s.sessionId === sessionId);
    expect(found).toBeUndefined();
  });

  it('does not find scheduled sessions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');

    const sessionId = await createTestSession(userId, patientId, {
      status: 'scheduled',
      daysAgoUpdated: 10,
    });

    const result = await findSessionsMissingNotes();

    const found = result.sessionsFound.find((s) => s.sessionId === sessionId);
    expect(found).toBeUndefined();
  });

  it('does not find soft-deleted done sessions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Fernando Lima');

    const sessionId = await createTestSession(userId, patientId, {
      status: 'done',
      daysAgoUpdated: 10,
      deletedAt: new Date(),
    });

    const result = await findSessionsMissingNotes();

    const found = result.sessionsFound.find((s) => s.sessionId === sessionId);
    expect(found).toBeUndefined();
  });

  it('emits correct event payload per matching session', async () => {
    const userId = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientA, 'Patient A');
    await seedPatient(userId, patientB, 'Patient B');

    const sessionA = await createTestSession(userId, patientA, {
      status: 'done',
      daysAgoUpdated: 8,
    });
    const sessionB = await createTestSession(userId, patientB, {
      status: 'done',
      daysAgoUpdated: 14,
    });

    const result = await findSessionsMissingNotes();

    const eventA = result.events.find((e) => e.sessionId === sessionA);
    const eventB = result.events.find((e) => e.sessionId === sessionB);

    expect(eventA).toBeDefined();
    expect(eventA!.patientId).toBe(patientA);
    expect(eventA!.userId).toBe(userId);
    expect(eventA!.daysSinceDone).toBeGreaterThanOrEqual(8);
    expect(eventA!.doneAt).toBeInstanceOf(Date);

    expect(eventB).toBeDefined();
    expect(eventB!.patientId).toBe(patientB);
    expect(eventB!.userId).toBe(userId);
    expect(eventB!.daysSinceDone).toBeGreaterThanOrEqual(14);
  });

  it('does not find no_show sessions even if older than 7 days', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Marcos Ribeiro');

    const sessionId = await createTestSession(userId, patientId, {
      status: 'no_show',
      daysAgoUpdated: 10,
    });

    const result = await findSessionsMissingNotes();

    const found = result.sessionsFound.find((s) => s.sessionId === sessionId);
    expect(found).toBeUndefined();
  });
});
