import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Mocks
//
// Inngest client: assert the detractor event is (or isn't) enqueued without a
// real Inngest connection.
//
// Shared logger: capture every structured payload that reaches the logger so we
// can prove the LGPD contract — the payload carries the internal user id but
// NEVER the email/name/feedback.
// ---------------------------------------------------------------------------

const inngestSend = vi.fn().mockResolvedValue(undefined);

vi.mock('@/modules/nps/inngest/client', () => ({
  inngest: { send: inngestSend },
}));

const logCalls: Array<Record<string, unknown>> = [];

vi.mock('@/shared/lib/logger', () => {
  const child = {
    info: vi.fn((payload: Record<string, unknown>) => logCalls.push(payload)),
    error: vi.fn((payload: Record<string, unknown>) => logCalls.push(payload)),
    debug: vi.fn(),
    warn: vi.fn(),
  };
  return {
    logger: { child: vi.fn(() => child), ...child },
    redactPaths: [],
  };
});

// Imported AFTER the mocks so the impl picks up the mocked inngest + logger.
const { submitNpsImpl } = await import('@/modules/nps');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PII_EMAIL_FRAGMENT = 'patient-pii';
const PII_FEEDBACK = 'meu paciente João reclamou do app';

// `handle_new_user()` (SECURITY DEFINER trigger) materializes `public.profiles`
// from `raw_user_meta_data`, so the metadata it requires MUST be present. The
// email carries a recognizable fragment so we can assert it never reaches a log.
async function seedAuthUser(userId: string): Promise<void> {
  const meta = JSON.stringify({
    fullName: 'Seed NPS Psychologist',
    crpNumber: userId.slice(0, 6),
    crpUf: 'SP',
    termsAcceptedAt: '2026-01-01T00:00:00Z',
    privacyAcceptedAt: '2026-01-01T00:00:00Z',
    sensitiveDataConsentAt: '2026-01-01T00:00:00Z',
  });
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
           VALUES (${userId}, ${`${PII_EMAIL_FRAGMENT}-${userId}@example.com`},
                   '{"provider":"email"}'::jsonb, ${meta}::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function readNps(userId: string): Promise<{
  npsScore: number | null;
  npsFeedback: string | null;
  npsRespondedAt: Date | null;
}> {
  return runAsService(async (db) => {
    const rows = await db
      .select({
        npsScore: profiles.npsScore,
        npsFeedback: profiles.npsFeedback,
        npsRespondedAt: profiles.npsRespondedAt,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return {
      npsScore: rows[0]?.npsScore ?? null,
      npsFeedback: rows[0]?.npsFeedback ?? null,
      npsRespondedAt: rows[0]?.npsRespondedAt ?? null,
    };
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof submitNpsImpl>[0];
}

beforeAll(async () => {
  await cleanTestData();
});

beforeEach(() => {
  inngestSend.mockClear();
  logCalls.length = 0;
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

describe('submitNpsImpl — real Postgres', () => {
  it('returns UNAUTHORIZED and writes nothing when there is no session', async () => {
    const result = await submitNpsImpl(fakeSupabaseClient(null), { score: 9 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("persists a valid answer on the owner's row only", async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await submitNpsImpl(fakeSupabaseClient(userId), {
      score: 9,
      feedback: 'great product',
    });
    expect(result.ok).toBe(true);

    const row = await readNps(userId);
    expect(row.npsScore).toBe(9);
    expect(row.npsFeedback).toBe('great product');
    expect(row.npsRespondedAt).toBeInstanceOf(Date);
  });

  it('rejects an out-of-range score (12) at the boundary and writes nothing', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await submitNpsImpl(fakeSupabaseClient(userId), { score: 12 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');

    const row = await readNps(userId);
    expect(row.npsScore).toBeNull();
    expect(row.npsRespondedAt).toBeNull();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('dismissal stamps nps_responded_at with a null score', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await submitNpsImpl(fakeSupabaseClient(userId), { dismiss: true });
    expect(result.ok).toBe(true);

    const row = await readNps(userId);
    expect(row.npsRespondedAt).toBeInstanceOf(Date);
    expect(row.npsScore).toBeNull();
    expect(row.npsFeedback).toBeNull();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it('a second submission is a no-op (ALREADY_RESPONDED) and never overwrites', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const first = await submitNpsImpl(fakeSupabaseClient(userId), { score: 8 });
    expect(first.ok).toBe(true);
    const firstRow = await readNps(userId);

    const second = await submitNpsImpl(fakeSupabaseClient(userId), { score: 2 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('ALREADY_RESPONDED');

    const secondRow = await readNps(userId);
    expect(secondRow.npsScore).toBe(8);
    expect(secondRow.npsRespondedAt?.getTime()).toBe(firstRow.npsRespondedAt?.getTime());
  });

  it('enqueues the detractor email event for a detractor score (4)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await submitNpsImpl(fakeSupabaseClient(userId), { score: 4 });
    expect(result.ok).toBe(true);

    expect(inngestSend).toHaveBeenCalledTimes(1);
    expect(inngestSend).toHaveBeenCalledWith({
      name: 'nps/detractor.submitted',
      data: { userId, score: 4 },
    });
  });

  it('does NOT enqueue the detractor email event for a promoter score (9)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await submitNpsImpl(fakeSupabaseClient(userId), { score: 9 });
    expect(result.ok).toBe(true);

    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("cannot write another user's row: only the session uid row is touched", async () => {
    // The action takes no caller-supplied id; the written row is decided solely
    // by the authenticated session. Authenticating as B writes B's row; A's
    // stays untouched.
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const result = await submitNpsImpl(fakeSupabaseClient(userB), { score: 7 });
    expect(result.ok).toBe(true);

    const rowB = await readNps(userB);
    const rowA = await readNps(userA);
    expect(rowB.npsScore).toBe(7);
    expect(rowA.npsScore).toBeNull();
    expect(rowA.npsRespondedAt).toBeNull();
  });

  it("enforces cross-user RLS: a user cannot write another user's NPS columns", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Under B's RLS-scoped connection, attempt to set A's NPS columns. RLS must
    // scope the UPDATE to B's own row, so A's row stays NULL.
    await runAsUser(userB, async (db) => {
      await db
        .update(profiles)
        .set({ npsScore: 1, npsRespondedAt: dsql`now()` })
        .where(eq(profiles.userId, userA));
    });

    const rowA = await readNps(userA);
    expect(rowA.npsScore).toBeNull();
    expect(rowA.npsRespondedAt).toBeNull();
  });

  it('logs the user id but never the email, name, or feedback (LGPD)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await submitNpsImpl(fakeSupabaseClient(userId), {
      score: 3,
      feedback: PII_FEEDBACK,
    });
    expect(result.ok).toBe(true);

    // At least one structured log line was emitted, and it carries the user id.
    expect(logCalls.length).toBeGreaterThan(0);
    expect(logCalls.some((c) => c.userId === userId)).toBe(true);

    const serialized = JSON.stringify(logCalls);
    expect(serialized).not.toContain(PII_FEEDBACK);
    expect(serialized).not.toContain('João');
    expect(serialized).not.toContain(PII_EMAIL_FRAGMENT);
    expect(serialized).not.toContain('Seed NPS Psychologist');
    // No `feedback` key surfaced into any log payload.
    expect(logCalls.every((c) => !('feedback' in c))).toBe(true);
  });
});
