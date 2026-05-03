import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { crpValidationQueueFactory } from '@/__tests__/integration/factories/crp-validation-queue';
import { psychologistProfileFactory } from '@/__tests__/integration/factories/psychologist-profiles';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// Logger spy mirrors the approve.int.test.ts setup. See that file for the
// full rationale on why the mock is installed at module scope and the SUT
// is imported lazily inside each test.
const warnSpy = vi.fn();
const errorSpy = vi.fn();
const infoSpy = vi.fn();
const debugSpy = vi.fn();

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]): void => {
      warnSpy(...args);
    },
    error: (...args: unknown[]): void => {
      errorSpy(...args);
    },
    info: (...args: unknown[]): void => {
      infoSpy(...args);
    },
    debug: (...args: unknown[]): void => {
      debugSpy(...args);
    },
  },
  redactPaths: [],
}));

async function seedAuthUser(userId: string, email = `${userId}@example.com`): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      sql`INSERT INTO auth.users (id, email, raw_app_meta_data)
          VALUES (${userId}, ${email}, '{}'::jsonb)
          ON CONFLICT (id) DO NOTHING`,
    );
  });
}

beforeEach(() => {
  warnSpy.mockReset();
  errorSpy.mockReset();
  infoSpy.mockReset();
  debugSpy.mockReset();
});

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(crpValidationQueue);
    await db.delete(psychologistProfiles);
    await db.execute(sql`DELETE FROM auth.users`);
  });
});

describe('rejectCrpValidation (integration)', () => {
  it('rejects the queue row, suspends the profile, and persists the reason in the same transaction', async () => {
    const userId = randomUUID();
    const adminUserId = randomUUID();
    const queueId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_crp_validation',
          crpNumber: '06/123456',
          crpUf: 'SP',
        }),
      );
      await db.insert(crpValidationQueue).values(
        crpValidationQueueFactory.build({
          id: queueId,
          userId,
          crpNumber: '06/123456',
          crpUf: 'SP',
          status: 'pending',
        }),
      );
    });

    const { rejectCrpValidation } = await import('@/modules/crp-validation');
    const result = await rejectCrpValidation({
      queueId,
      actorUserId: adminUserId,
      reason: 'CRP não localizado no cadastro do CFP',
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: true });

    // Queue row decided with reason persisted.
    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    const decided = queueRows[0]!;
    expect(decided.status).toBe('rejected');
    expect(decided.decidedAt).not.toBeNull();
    expect(decided.decidedBy).toBe(adminUserId);
    expect(decided.rejectionReason).toBe('CRP não localizado no cadastro do CFP');

    // Profile transitioned to suspended.
    const profiles = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profiles[0]!.status).toBe('suspended');

    // JWT mirror updated.
    const meta = await runAsService(async (db) =>
      db.execute<{ account_status: string }>(
        sql`SELECT raw_app_meta_data->>'account_status' AS account_status
            FROM auth.users WHERE id = ${userId}`,
      ),
    );
    expect(meta[0]?.account_status).toBe('suspended');

    // Audit log fired with decision payload — note the LGPD invariant:
    // the rejection reason MUST NOT appear in the log payload.
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload] = infoSpy.mock.calls[0]!;
    expect(payload).toMatchObject({
      event: 'crp_validation_decided',
      decision: 'rejected',
      queueId,
      userId,
      actorUserId: adminUserId,
    });
    expect(payload).not.toHaveProperty('reason');
    expect(payload).not.toHaveProperty('rejectionReason');
  });

  it('trims the reason before persisting (no leading/trailing whitespace)', async () => {
    const userId = randomUUID();
    const adminUserId = randomUUID();
    const queueId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_crp_validation',
        }),
      );
      await db.insert(crpValidationQueue).values(
        crpValidationQueueFactory.build({
          id: queueId,
          userId,
          status: 'pending',
        }),
      );
    });

    const { rejectCrpValidation } = await import('@/modules/crp-validation');
    const result = await rejectCrpValidation({
      queueId,
      actorUserId: adminUserId,
      reason: '   CRP inválido   ',
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: true });

    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows[0]!.rejectionReason).toBe('CRP inválido');
  });

  it('returns reason_required when the reason is empty (spec scenario)', async () => {
    const userId = randomUUID();
    const adminUserId = randomUUID();
    const queueId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_crp_validation',
        }),
      );
      await db.insert(crpValidationQueue).values(
        crpValidationQueueFactory.build({
          id: queueId,
          userId,
          status: 'pending',
        }),
      );
    });

    const { rejectCrpValidation } = await import('@/modules/crp-validation');
    const result = await rejectCrpValidation({
      queueId,
      actorUserId: adminUserId,
      reason: '',
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: false, error: 'reason_required' });

    // No DB changes.
    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows[0]!.status).toBe('pending');
    expect(queueRows[0]!.decidedAt).toBeNull();

    const profiles = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profiles[0]!.status).toBe('pending_crp_validation');

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('returns reason_required when the reason is whitespace-only', async () => {
    const userId = randomUUID();
    const adminUserId = randomUUID();
    const queueId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_crp_validation',
        }),
      );
      await db.insert(crpValidationQueue).values(
        crpValidationQueueFactory.build({
          id: queueId,
          userId,
          status: 'pending',
        }),
      );
    });

    const { rejectCrpValidation } = await import('@/modules/crp-validation');
    const result = await rejectCrpValidation({
      queueId,
      actorUserId: adminUserId,
      reason: '   \t\n   ',
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: false, error: 'reason_required' });

    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows[0]!.status).toBe('pending');
  });

  it('rejects non-service-role callers without touching the queue or profile', async () => {
    const userId = randomUUID();
    const adminUserId = randomUUID();
    const queueId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'pending_crp_validation',
        }),
      );
      await db.insert(crpValidationQueue).values(
        crpValidationQueueFactory.build({
          id: queueId,
          userId,
          status: 'pending',
        }),
      );
    });

    const { rejectCrpValidation } = await import('@/modules/crp-validation');
    const result = await rejectCrpValidation({
      queueId,
      actorUserId: adminUserId,
      reason: 'CRP inválido',
      isServiceRole: false,
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });

    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows[0]!.status).toBe('pending');

    const profiles = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profiles[0]!.status).toBe('pending_crp_validation');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      event: 'crp_validation_decided',
      decision: 'forbidden',
    });
  });

  it('returns already_decided when the queue row is no longer pending', async () => {
    const userId = randomUUID();
    const adminUserId = randomUUID();
    const queueId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'suspended',
        }),
      );
      await db.insert(crpValidationQueue).values(
        crpValidationQueueFactory.build({
          id: queueId,
          userId,
          status: 'rejected',
          decidedAt: new Date(),
          decidedBy: adminUserId,
          rejectionReason: 'previously rejected',
        }),
      );
    });

    const { rejectCrpValidation } = await import('@/modules/crp-validation');
    const result = await rejectCrpValidation({
      queueId,
      actorUserId: adminUserId,
      reason: 'try again',
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: false, error: 'already_decided' });

    // Pre-existing decision preserved.
    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows[0]!.rejectionReason).toBe('previously rejected');
  });

  it('returns queue_not_found when the queue id does not exist', async () => {
    const adminUserId = randomUUID();
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    const { rejectCrpValidation } = await import('@/modules/crp-validation');
    const result = await rejectCrpValidation({
      queueId: randomUUID(),
      actorUserId: adminUserId,
      reason: 'irrelevant',
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: false, error: 'queue_not_found' });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('rolls back the queue update when the profile is in an unexpected state (invalid_transition)', async () => {
    const userId = randomUUID();
    const adminUserId = randomUUID();
    const queueId = randomUUID();
    await seedAuthUser(userId);
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    // Pathological state: queue is pending but profile is `cancelled` (no
    // legal transition exists for `crp_rejected` from `cancelled`).
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'cancelled',
        }),
      );
      await db.insert(crpValidationQueue).values(
        crpValidationQueueFactory.build({
          id: queueId,
          userId,
          status: 'pending',
        }),
      );
    });

    const { rejectCrpValidation } = await import('@/modules/crp-validation');
    const result = await rejectCrpValidation({
      queueId,
      actorUserId: adminUserId,
      reason: 'CRP inválido',
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: false, error: 'invalid_transition' });

    // Queue UNCHANGED.
    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows[0]!.status).toBe('pending');
    expect(queueRows[0]!.decidedAt).toBeNull();
    expect(queueRows[0]!.rejectionReason).toBeNull();

    // Profile still cancelled.
    const profiles = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profiles[0]!.status).toBe('cancelled');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      event: 'crp_validation_decided',
      decision: 'reject_rolled_back',
      reason: 'invalid_transition',
    });
  });
});
