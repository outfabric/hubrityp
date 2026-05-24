import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionImpl } from '@/modules/agenda/server/create-session';
import { updateSessionImpl } from '@/modules/agenda/server/update-session';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock Inngest client — intercept `inngest.send()` at the module level so
// the real DB path runs but no outbound HTTP call leaves the test.
// vi.hoisted() ensures the reference is available when vi.mock() factories
// execute (they are hoisted above imports by Vitest).
// ---------------------------------------------------------------------------

const { mockInngestSend } = vi.hoisted(() => ({
  mockInngestSend: vi.fn(),
}));

vi.mock('@/modules/agenda/inngest/client', () => ({
  inngest: { send: mockInngestSend },
}));

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

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof createSessionImpl>[0];
}

/** Returns an ISO 8601 datetime string for a future date. */
function futureDate(hoursFromNow: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockInngestSend.mockResolvedValue({ ids: ['evt-mock'] });
});

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests — Inngest event emission during create/update with real Postgres
// ---------------------------------------------------------------------------

describe('agenda/session.created — Inngest event via real Postgres', () => {
  it('(a) emits agenda/session.created with correct payload on session creation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Silva');
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
      modality: 'online',
      force_conflict: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const sendArg = mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.name).toBe('agenda/session.created');
    expect(sendArg.data.sessionId).toBe(result.sessionId);
    expect(sendArg.data.userId).toBe(userId);
    expect(sendArg.data.patientId).toBe(patientId);
    expect(sendArg.data.modality).toBe('online');
    expect(sendArg.data.status).toBe('scheduled');
    expect(sendArg.data.startAt).toBeInstanceOf(Date);
    expect(sendArg.data.endAt).toBeInstanceOf(Date);

    // Verify session was persisted in real Postgres
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, result.sessionId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.modality).toBe('online');
  });

  it('(c) emits event with patientId: null for blocking slot (no patient)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await createSessionImpl(client, {
      is_blocking: true,
      blocking_title: 'Almoco',
      start_at: futureDate(48),
      duration_minutes: 60,
      force_conflict: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const sendArg = mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.name).toBe('agenda/session.created');
    expect(sendArg.data.sessionId).toBe(result.sessionId);
    expect(sendArg.data.userId).toBe(userId);
    expect(sendArg.data.patientId).toBeNull();
    expect(sendArg.data.modality).toBeNull();
    expect(sendArg.data.status).toBe('scheduled');
  });
});

describe('agenda/session.updated — Inngest event via real Postgres', () => {
  it('(b) emits agenda/session.updated with previousModality when modality changes', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Alves');
    const client = fakeSupabaseClient(userId);

    // Create session with modality 'in_person'
    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
      modality: 'in_person',
      force_conflict: true,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    // Clear mocks from creation so we only inspect the update call
    vi.clearAllMocks();
    mockInngestSend.mockResolvedValue({ ids: ['evt-mock'] });

    // Read back the session to get its current start_at (for the update payload)
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, createResult.sessionId));
    });
    const existingStartAt = rows[0]!.startAt.toISOString();

    // Update modality from 'in_person' to 'online'
    const updateResult = await updateSessionImpl(client, createResult.sessionId, {
      patient_id: patientId,
      start_at: existingStartAt,
      duration_minutes: 50,
      modality: 'online',
      force_conflict: true,
    });

    expect(updateResult.ok).toBe(true);

    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const sendArg = mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.name).toBe('agenda/session.updated');
    expect(sendArg.data.sessionId).toBe(createResult.sessionId);
    expect(sendArg.data.userId).toBe(userId);
    expect(sendArg.data.patientId).toBe(patientId);
    expect(sendArg.data.modality).toBe('online');
    expect(sendArg.data.previousModality).toBe('in_person');
    expect(sendArg.data.status).toBe('scheduled');
    expect(sendArg.data.startAt).toBeInstanceOf(Date);
    expect(sendArg.data.endAt).toBeInstanceOf(Date);
  });

  it('(d) emits event with matching previousModality when modality is unchanged', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Lucia Mendes');
    const client = fakeSupabaseClient(userId);

    // Create session with modality 'online'
    const createResult = await createSessionImpl(client, {
      patient_id: patientId,
      start_at: futureDate(24),
      duration_minutes: 50,
      modality: 'online',
      force_conflict: true,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    vi.clearAllMocks();
    mockInngestSend.mockResolvedValue({ ids: ['evt-mock'] });

    // Read back the session to get its current start_at
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, createResult.sessionId));
    });
    const existingStartAt = rows[0]!.startAt.toISOString();

    // Update notes only — modality stays 'online'
    const updateResult = await updateSessionImpl(client, createResult.sessionId, {
      patient_id: patientId,
      start_at: existingStartAt,
      duration_minutes: 50,
      modality: 'online',
      notes: 'Updated note',
      force_conflict: true,
    });

    expect(updateResult.ok).toBe(true);

    expect(mockInngestSend).toHaveBeenCalledTimes(1);

    const sendArg = mockInngestSend.mock.calls[0]![0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(sendArg.name).toBe('agenda/session.updated');
    expect(sendArg.data.sessionId).toBe(createResult.sessionId);
    expect(sendArg.data.modality).toBe('online');
    expect(sendArg.data.previousModality).toBe('online');
    expect(sendArg.data.status).toBe('scheduled');
  });
});
