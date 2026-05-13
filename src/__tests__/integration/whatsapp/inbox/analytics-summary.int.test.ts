import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { runAsUser } from '@/__tests__/integration/setup/run-as-user';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

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
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Paciente Teste',
      phone: '+5511988887777',
      ...overrides,
    });
  });
}

interface MessageSeed {
  direction: 'outbound' | 'inbound';
  status: string;
  templateKey?: string;
  sessionId?: string;
  createdAt?: Date;
}

async function seedMessage(userId: string, patientId: string, opts: MessageSeed): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(whatsappMessages).values({
      id,
      userId,
      patientId,
      direction: opts.direction,
      status: opts.status,
      templateKey: opts.templateKey ?? null,
      sessionId: opts.sessionId ?? null,
      body: 'test message',
      createdAt: opts.createdAt ?? new Date(),
    });
  });
  return id;
}

async function seedSession(
  userId: string,
  patientId: string,
  opts: { confirmedAt?: Date; startAt?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  const startAt = opts.startAt ?? new Date();
  const endAt = new Date(startAt.getTime() + 50 * 60_000);
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id,
      userId,
      patientId,
      startAt,
      endAt,
      durationMinutes: 50,
      status: opts.confirmedAt ? 'confirmed' : 'scheduled',
      confirmedAt: opts.confirmedAt ?? null,
    });
  });
  return id;
}

function fakeSupabase(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getAnalyticsSummaryImpl — counts by status', () => {
  it('returns correct counts for various message statuses', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const now = new Date();

    // 3 outbound messages (sent)
    await seedMessage(userId, patientId, { direction: 'outbound', status: 'sent', createdAt: now });
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: now,
    });
    await seedMessage(userId, patientId, { direction: 'outbound', status: 'read', createdAt: now });

    // 1 failed outbound
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'failed',
      createdAt: now,
    });

    // 1 inbound (should not count as sent)
    await seedMessage(userId, patientId, {
      direction: 'inbound',
      status: 'delivered',
      createdAt: now,
    });

    const { getAnalyticsSummaryImpl } =
      await import('@/modules/whatsapp/server/inbox/get-analytics-summary');

    const dateFrom = new Date(now.getTime() - 86_400_000); // 1 day before
    const dateTo = new Date(now.getTime() + 86_400_000); // 1 day after

    const result = await getAnalyticsSummaryImpl(
      fakeSupabase(userId),
      { dateFrom, dateTo },
      { templatePriceBrl: 0.1 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 4 outbound messages total (sent, delivered, read, failed)
    expect(result.data.totalSent).toBe(4);
    // delivered + read (status 'delivered' or 'read') — includes the inbound 'delivered'
    expect(result.data.totalDelivered).toBe(3);
    // only 'read' status
    expect(result.data.totalRead).toBe(1);
    // only 'failed' status
    expect(result.data.totalFailed).toBe(1);
  });

  it('returns zeroes when there are no messages in the period', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const { getAnalyticsSummaryImpl } =
      await import('@/modules/whatsapp/server/inbox/get-analytics-summary');

    const dateFrom = new Date('2020-01-01T00:00:00Z');
    const dateTo = new Date('2020-01-31T23:59:59.999Z');

    const result = await getAnalyticsSummaryImpl(
      fakeSupabase(userId),
      { dateFrom, dateTo },
      { templatePriceBrl: 0.1 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totalSent).toBe(0);
    expect(result.data.totalDelivered).toBe(0);
    expect(result.data.totalRead).toBe(0);
    expect(result.data.totalConfirmed).toBe(0);
    expect(result.data.totalFailed).toBe(0);
    expect(result.data.estimatedCostBrl).toBe(0);
  });
});

describe('getAnalyticsSummaryImpl — cost estimation', () => {
  it('calculates estimated cost based on template message count and price', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const now = new Date();

    // 3 outbound template messages
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      templateKey: 'lembrete_24h',
      createdAt: now,
    });
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'sent',
      templateKey: 'lembrete_2h',
      createdAt: now,
    });
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'read',
      templateKey: 'confirmacao_recebida',
      createdAt: now,
    });

    // 1 outbound non-template message (free text reply) — should NOT count for cost
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: now,
    });

    // 1 inbound message with template_key (shouldn't happen but ensures direction filter works)
    await seedMessage(userId, patientId, {
      direction: 'inbound',
      status: 'delivered',
      templateKey: 'lembrete_24h',
      createdAt: now,
    });

    const { getAnalyticsSummaryImpl } =
      await import('@/modules/whatsapp/server/inbox/get-analytics-summary');

    const dateFrom = new Date(now.getTime() - 86_400_000);
    const dateTo = new Date(now.getTime() + 86_400_000);
    const priceBrl = 0.25;

    const result = await getAnalyticsSummaryImpl(
      fakeSupabase(userId),
      { dateFrom, dateTo },
      { templatePriceBrl: priceBrl },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 3 outbound template messages * 0.25 = 0.75
    expect(result.data.estimatedCostBrl).toBeCloseTo(0.75, 2);
  });
});

describe('getAnalyticsSummaryImpl — confirmed sessions', () => {
  it('counts distinct sessions with confirmed_at that have WhatsApp messages in the period', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const now = new Date();

    // Session 1: confirmed, with a WhatsApp message in period
    const sessionId1 = await seedSession(userId, patientId, {
      confirmedAt: now,
      startAt: now,
    });
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      sessionId: sessionId1,
      createdAt: now,
    });
    // A second message for the same session — should still count as 1
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'read',
      sessionId: sessionId1,
      createdAt: now,
    });

    // Session 2: confirmed, with a WhatsApp message in period
    const sessionId2 = await seedSession(userId, patientId, {
      confirmedAt: now,
      startAt: now,
    });
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      sessionId: sessionId2,
      createdAt: now,
    });

    // Session 3: NOT confirmed — should NOT be counted
    const sessionId3 = await seedSession(userId, patientId, {
      startAt: now,
    });
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      sessionId: sessionId3,
      createdAt: now,
    });

    // Session 4: confirmed but NO WhatsApp message — should NOT be counted
    await seedSession(userId, patientId, {
      confirmedAt: now,
      startAt: now,
    });

    const { getAnalyticsSummaryImpl } =
      await import('@/modules/whatsapp/server/inbox/get-analytics-summary');

    const dateFrom = new Date(now.getTime() - 86_400_000);
    const dateTo = new Date(now.getTime() + 86_400_000);

    const result = await getAnalyticsSummaryImpl(
      fakeSupabase(userId),
      { dateFrom, dateTo },
      { templatePriceBrl: 0.1 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only sessions 1 and 2 qualify (confirmed + have WA message in period)
    expect(result.data.totalConfirmed).toBe(2);
  });
});

describe('getAnalyticsSummaryImpl — period filters', () => {
  it('excludes messages outside the specified date range', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const inRange = new Date('2025-03-15T12:00:00Z');
    const outOfRange = new Date('2025-02-10T12:00:00Z');

    // Message in range
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: inRange,
    });

    // Message out of range
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: outOfRange,
    });

    const { getAnalyticsSummaryImpl } =
      await import('@/modules/whatsapp/server/inbox/get-analytics-summary');

    const result = await getAnalyticsSummaryImpl(
      fakeSupabase(userId),
      {
        dateFrom: new Date('2025-03-01T00:00:00Z'),
        dateTo: new Date('2025-03-31T23:59:59.999Z'),
      },
      { templatePriceBrl: 0.1 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.totalSent).toBe(1);
  });

  it('defaults to current month when no period is provided', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Message created now (should be in the current month)
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: new Date(),
    });

    // Message from 2 years ago (should be excluded)
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    await seedMessage(userId, patientId, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: twoYearsAgo,
    });

    const { getAnalyticsSummaryImpl } =
      await import('@/modules/whatsapp/server/inbox/get-analytics-summary');

    // Call without dateFrom/dateTo — should default to current month
    const result = await getAnalyticsSummaryImpl(
      fakeSupabase(userId),
      {},
      { templatePriceBrl: 0.1 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the current month message should appear
    expect(result.data.totalSent).toBe(1);
  });
});

describe('getAnalyticsSummaryImpl — RLS cross-user isolation', () => {
  it('psychologist A cannot see messages of psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedPatient(userIdA, patientA, { fullName: 'Paciente A' });
    await seedPatient(userIdB, patientB, { fullName: 'Paciente B' });

    const now = new Date();

    // User A: 2 outbound messages
    await seedMessage(userIdA, patientA, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: now,
    });
    await seedMessage(userIdA, patientA, {
      direction: 'outbound',
      status: 'read',
      createdAt: now,
    });

    // User B: 3 outbound messages
    await seedMessage(userIdB, patientB, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: now,
    });
    await seedMessage(userIdB, patientB, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: now,
    });
    await seedMessage(userIdB, patientB, {
      direction: 'outbound',
      status: 'failed',
      createdAt: now,
    });

    const { getAnalyticsSummaryImpl } =
      await import('@/modules/whatsapp/server/inbox/get-analytics-summary');

    const dateFrom = new Date(now.getTime() - 86_400_000);
    const dateTo = new Date(now.getTime() + 86_400_000);

    // User A should see only their 2 messages
    const resultA = await getAnalyticsSummaryImpl(
      fakeSupabase(userIdA),
      { dateFrom, dateTo },
      { templatePriceBrl: 0.1 },
    );

    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.data.totalSent).toBe(2);

    // User B should see only their 3 messages
    const resultB = await getAnalyticsSummaryImpl(
      fakeSupabase(userIdB),
      { dateFrom, dateTo },
      { templatePriceBrl: 0.1 },
    );

    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.data.totalSent).toBe(3);
    expect(resultB.data.totalFailed).toBe(1);
  });

  it('RLS blocks cross-user SELECT on whatsapp_messages', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    const patientB = randomUUID();
    await seedPatient(userIdB, patientB, { fullName: 'Paciente B' });

    await seedMessage(userIdB, patientB, {
      direction: 'outbound',
      status: 'delivered',
      createdAt: new Date(),
    });

    // User A tries to query user B's messages directly via RLS-enforced connection
    const rows = await runAsUser(userIdA, async (db) => {
      return db.select().from(whatsappMessages);
    });

    // Should see 0 rows — RLS blocks cross-user access
    expect(rows).toHaveLength(0);
  });
});

describe('getAnalyticsSummaryImpl — authentication', () => {
  it('returns unauthenticated when no user in session', async () => {
    const { getAnalyticsSummaryImpl } =
      await import('@/modules/whatsapp/server/inbox/get-analytics-summary');

    const result = await getAnalyticsSummaryImpl(fakeSupabase(null));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});
