import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { generateConfirmationToken } from '@/modules/agenda/lib/confirmation-token';
import { getSessionByTokenImpl } from '@/modules/agenda/server/get-session-by-token';
import { publicConfirmSessionImpl } from '@/modules/agenda/server/public-confirm-session';
import { publicDeclineSessionImpl } from '@/modules/agenda/server/public-decline-session';
import { sessions, sessionHistory } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string, fullName = 'Dra. Maria Silva'): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
    // Insert profile for psychologist name lookup
    await db.execute(
      dsql`INSERT INTO profiles (user_id, email, full_name, crp_number, crp_uf, terms_accepted_at, privacy_accepted_at, sensitive_data_consent_at)
           VALUES (${userId}, ${`test-${userId}@example.com`}, ${fullName}, ${'12345'}, ${'SP'}, now(), now(), now())
           ON CONFLICT (user_id) DO NOTHING`,
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

/** Creates a session with a confirmation token and returns { sessionId, token }. */
async function createSessionWithToken(
  userId: string,
  patientId: string,
  options: { hoursFromNow?: number; status?: string } = {},
): Promise<{ sessionId: string; token: string }> {
  const { hoursFromNow = 48, status = 'scheduled' } = options;
  const sessionId = randomUUID();
  const token = generateConfirmationToken();
  const startAt = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const endAt = new Date(startAt.getTime() + 50 * 60 * 1000);

  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt,
      endAt,
      durationMinutes: 50,
      status,
      confirmationToken: token,
    });
  });

  return { sessionId, token };
}

afterEach(async () => {
  await cleanTestData();
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM profiles WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// getSessionByTokenImpl
// =====================================================================

describe('getSessionByTokenImpl', () => {
  it('returns valid state with public-safe data for a scheduled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId, 'Dra. Ana Costa');
    await seedPatient(userId, patientId, 'Carlos Mendes');
    const { token } = await createSessionWithToken(userId, patientId);

    const result = await getSessionByTokenImpl(token);

    expect(result.state).toBe('valid');
    if (result.state !== 'valid') return;
    expect(result.data.psychologistName).toBe('Dra. Ana Costa');
    expect(result.data.date).toBeInstanceOf(Date);
    expect(result.data.durationMinutes).toBe(50);
  });

  it('returns expired state when session start has passed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { token } = await createSessionWithToken(userId, patientId, {
      hoursFromNow: -1,
    });

    const result = await getSessionByTokenImpl(token);
    expect(result.state).toBe('expired');
  });

  it('returns already_responded when session is confirmed', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { sessionId, token } = await createSessionWithToken(userId, patientId);

    // Set status to confirmed
    await runAsService(async (db) => {
      await db
        .update(sessions)
        .set({ status: 'confirmed', confirmedAt: new Date() })
        .where(eq(sessions.id, sessionId));
    });

    const result = await getSessionByTokenImpl(token);
    expect(result.state).toBe('already_responded');
  });

  it('returns cancelled state when session is cancelled', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { sessionId, token } = await createSessionWithToken(userId, patientId);

    // Set status to cancelled
    await runAsService(async (db) => {
      await db.update(sessions).set({ status: 'cancelled' }).where(eq(sessions.id, sessionId));
    });

    const result = await getSessionByTokenImpl(token);
    expect(result.state).toBe('cancelled');
  });

  it('returns invalid for a nonexistent token', async () => {
    const result = await getSessionByTokenImpl('nonexistent-token-value');
    expect(result.state).toBe('invalid');
  });

  it('returns invalid for empty token', async () => {
    const result = await getSessionByTokenImpl('');
    expect(result.state).toBe('invalid');
  });
});

// =====================================================================
// publicConfirmSessionImpl
// =====================================================================

describe('publicConfirmSessionImpl', () => {
  it('confirms a scheduled session via valid token (status changes, confirmed_at set, history with performed_by=patient)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Pedro Lima');
    const { sessionId, token } = await createSessionWithToken(userId, patientId);

    const result = await publicConfirmSessionImpl(token);
    expect(result.ok).toBe(true);

    // Verify status changed
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('confirmed');
    expect(rows[0]!.confirmedAt).toBeTruthy();

    // Verify history entry with performed_by='patient'
    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    const statusEntry = historyRows.find((h) => h.action === 'status_changed');
    expect(statusEntry).toBeDefined();
    const changes = statusEntry!.changes as {
      status: { old: string; new: string };
      performedBy: string;
    };
    expect(changes.status.old).toBe('scheduled');
    expect(changes.status.new).toBe('confirmed');
    expect(changes.performedBy).toBe('patient');
  });

  it('returns expired for token with past session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { token } = await createSessionWithToken(userId, patientId, {
      hoursFromNow: -1,
    });

    const result = await publicConfirmSessionImpl(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('expired');
  });

  it('returns already_responded for already confirmed session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { token } = await createSessionWithToken(userId, patientId);

    // First confirm
    await publicConfirmSessionImpl(token);

    // Second attempt
    const result = await publicConfirmSessionImpl(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('already_responded');
  });

  it('returns invalid_token for nonexistent token', async () => {
    const result = await publicConfirmSessionImpl('nonexistent-token-abc123');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_token');
  });

  it('returns cancelled for cancelled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { sessionId, token } = await createSessionWithToken(userId, patientId);

    // Cancel the session directly
    await runAsService(async (db) => {
      await db.update(sessions).set({ status: 'cancelled' }).where(eq(sessions.id, sessionId));
    });

    const result = await publicConfirmSessionImpl(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cancelled');
  });

  it('cross-patient token works (token is authorization, not identity)', async () => {
    // Token works regardless of which patient created the session --
    // the token itself is the authorization credential.
    const userId = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientA, 'Patient A');
    await seedPatient(userId, patientB, 'Patient B');

    // Create session for patient A
    const { token } = await createSessionWithToken(userId, patientA);

    // Token can be used by anyone who has it -- no identity check
    const result = await publicConfirmSessionImpl(token);
    expect(result.ok).toBe(true);
  });
});

// =====================================================================
// publicDeclineSessionImpl
// =====================================================================

describe('publicDeclineSessionImpl', () => {
  it('declines a scheduled session via valid token (cancellation fields populated, notice calculated, history with performed_by=patient)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Maria Santos');
    const { sessionId, token } = await createSessionWithToken(userId, patientId, {
      hoursFromNow: 48,
    });

    const result = await publicDeclineSessionImpl(token, 'Tenho compromisso');
    expect(result.ok).toBe(true);

    // Verify cancellation fields
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.status).toBe('cancelled');
    expect(rows[0]!.cancellationReason).toBe('patient_cancelled');
    expect(rows[0]!.cancelledBy).toBe('patient');
    expect(rows[0]!.cancellationNotice).toBe('24h+');
    expect(rows[0]!.cancelledAt).toBeTruthy();
    expect(rows[0]!.chargeCancellation).toBe(false);

    // Verify history entry with performed_by='patient' and patient reason
    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    const statusEntry = historyRows.find((h) => h.action === 'status_changed');
    expect(statusEntry).toBeDefined();
    const changes = statusEntry!.changes as {
      status: { old: string; new: string };
      performedBy: string;
      cancellation: {
        reason: string;
        cancelledBy: string;
        notice: string;
        chargeCancellation: boolean;
        patientReason: string | null;
      };
    };
    expect(changes.status.old).toBe('scheduled');
    expect(changes.status.new).toBe('cancelled');
    expect(changes.performedBy).toBe('patient');
    expect(changes.cancellation.patientReason).toBe('Tenho compromisso');
  });

  it('calculates notice correctly for less than 24h cancellation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { sessionId, token } = await createSessionWithToken(userId, patientId, {
      hoursFromNow: 5,
    });

    const result = await publicDeclineSessionImpl(token);
    expect(result.ok).toBe(true);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });
    expect(rows[0]!.cancellationNotice).toBe('less_24h');
  });

  it('returns expired for token with past session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { token } = await createSessionWithToken(userId, patientId, {
      hoursFromNow: -1,
    });

    const result = await publicDeclineSessionImpl(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('expired');
  });

  it('returns already_responded for already confirmed session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { token } = await createSessionWithToken(userId, patientId);

    // First confirm the session
    await publicConfirmSessionImpl(token);

    // Try to decline
    const result = await publicDeclineSessionImpl(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('already_responded');
  });

  it('returns invalid_token for nonexistent token', async () => {
    const result = await publicDeclineSessionImpl('nonexistent-token-xyz');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_token');
  });

  it('returns cancelled for already cancelled session', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { sessionId, token } = await createSessionWithToken(userId, patientId);

    // Cancel directly
    await runAsService(async (db) => {
      await db.update(sessions).set({ status: 'cancelled' }).where(eq(sessions.id, sessionId));
    });

    const result = await publicDeclineSessionImpl(token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cancelled');
  });

  it('works without optional reason text', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { sessionId, token } = await createSessionWithToken(userId, patientId);

    const result = await publicDeclineSessionImpl(token);
    expect(result.ok).toBe(true);

    // Verify patientReason is null when not provided
    const historyRows = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    const statusEntry = historyRows.find((h) => h.action === 'status_changed');
    expect(statusEntry).toBeDefined();
    const changes = statusEntry!.changes as {
      cancellation: { patientReason: string | null };
    };
    expect(changes.cancellation.patientReason).toBeNull();
  });
});

// =====================================================================
// Service-role bypasses RLS
// =====================================================================

describe('service-role bypasses RLS', () => {
  it('public functions access sessions without auth (token is authorization)', async () => {
    // All public functions use Drizzle's db client which connects via
    // DATABASE_URL (superuser in tests, service-role pool in production).
    // No Supabase auth client is involved.
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId, 'Test Patient');
    const { token } = await createSessionWithToken(userId, patientId);

    // getSessionByToken works without any auth
    const lookupResult = await getSessionByTokenImpl(token);
    expect(lookupResult.state).toBe('valid');

    // publicConfirmSession works without any auth
    const confirmResult = await publicConfirmSessionImpl(token);
    expect(confirmResult.ok).toBe(true);
  });
});
