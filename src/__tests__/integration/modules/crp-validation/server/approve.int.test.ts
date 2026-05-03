import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { crpValidationQueueFactory } from '@/__tests__/integration/factories/crp-validation-queue';
import { psychologistProfileFactory } from '@/__tests__/integration/factories/psychologist-profiles';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

// We mock the logger to keep the integration suite output silent AND to
// surface whether `crp_validation_decided` audit lines fire on each branch.
// The integration globalSetup sets `LOG_LEVEL=silent`, but a real pino logger
// would still execute redaction etc. — the spy approach lets us assert on
// emitted payloads without that overhead.
//
// The mock MUST be installed BEFORE the SUT (`approveCrpValidation`) is
// imported, so we use a top-level `vi.mock` and `await import` the module
// inside each test.
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

// Seed a row in the bootstrap-stub `auth.users` table so the FK from
// `psychologist_profiles.user_id` resolves. Mirrors the helper used by the
// `account-lifecycle` integration tests.
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
  // Clean up in dependency order. The trigger on `psychologist_profiles`
  // uses SECURITY DEFINER, so the service-role connection (which bypasses
  // RLS) is the right channel for teardown.
  await runAsService(async (db) => {
    await db.delete(crpValidationQueue);
    await db.delete(psychologistProfiles);
    await db.execute(sql`DELETE FROM auth.users`);
  });
});

describe('approveCrpValidation (integration)', () => {
  it('approves the queue row and activates the profile in the same transaction', async () => {
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

    const { approveCrpValidation } = await import('@/modules/crp-validation');
    const result = await approveCrpValidation({
      queueId,
      actorUserId: adminUserId,
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: true });

    // Queue row decided.
    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows).toHaveLength(1);
    const decided = queueRows[0]!;
    expect(decided.status).toBe('approved');
    expect(decided.decidedAt).not.toBeNull();
    expect(decided.decidedBy).toBe(adminUserId);
    expect(decided.rejectionReason).toBeNull();

    // Profile transitioned to active.
    const profiles = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profiles[0]!.status).toBe('active');

    // JWT mirror was advanced by the AFTER UPDATE trigger.
    const meta = await runAsService(async (db) =>
      db.execute<{ account_status: string }>(
        sql`SELECT raw_app_meta_data->>'account_status' AS account_status
            FROM auth.users WHERE id = ${userId}`,
      ),
    );
    expect(meta[0]?.account_status).toBe('active');

    // Audit log fired with the decision payload (LGPD: identifiers only,
    // no PII / no card photo / no reason on approval).
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toMatchObject({
      event: 'crp_validation_decided',
      decision: 'approved',
      queueId,
      userId,
      actorUserId: adminUserId,
    });
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

    const { approveCrpValidation } = await import('@/modules/crp-validation');
    const result = await approveCrpValidation({
      queueId,
      actorUserId: adminUserId,
      isServiceRole: false,
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });

    // Nothing changed — queue remains pending, profile remains in
    // pending_crp_validation, no info-level audit emitted.
    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows[0]!.status).toBe('pending');
    expect(queueRows[0]!.decidedAt).toBeNull();
    expect(queueRows[0]!.decidedBy).toBeNull();

    const profiles = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profiles[0]!.status).toBe('pending_crp_validation');

    expect(infoSpy).not.toHaveBeenCalled();
    // The forbidden gate logs at WARN with `decision: 'forbidden'`.
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
          status: 'active', // already approved earlier
        }),
      );
      await db.insert(crpValidationQueue).values(
        crpValidationQueueFactory.build({
          id: queueId,
          userId,
          status: 'approved', // already decided
          decidedAt: new Date(),
          decidedBy: adminUserId,
        }),
      );
    });

    const { approveCrpValidation } = await import('@/modules/crp-validation');
    const result = await approveCrpValidation({
      queueId,
      actorUserId: adminUserId,
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: false, error: 'already_decided' });

    // Profile unchanged.
    const profiles = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profiles[0]!.status).toBe('active');

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('returns queue_not_found when the queue id does not exist', async () => {
    const adminUserId = randomUUID();
    await seedAuthUser(adminUserId, `${adminUserId}@admin.example.com`);

    const { approveCrpValidation } = await import('@/modules/crp-validation');
    const result = await approveCrpValidation({
      queueId: randomUUID(), // never inserted
      actorUserId: adminUserId,
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

    // Pathological state: queue is pending but profile is already active.
    // `applyTransition(userId, 'crp_approved')` from `active` returns
    // `invalid_transition`, which MUST roll back the queue UPDATE.
    await runAsService(async (db) => {
      await db.insert(psychologistProfiles).values(
        psychologistProfileFactory.build({
          userId,
          status: 'active',
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

    const { approveCrpValidation } = await import('@/modules/crp-validation');
    const result = await approveCrpValidation({
      queueId,
      actorUserId: adminUserId,
      isServiceRole: true,
    });

    expect(result).toEqual({ ok: false, error: 'invalid_transition' });

    // Queue row UNCHANGED — the rollback nuked the UPDATE.
    const queueRows = await runAsService(async (db) =>
      db.select().from(crpValidationQueue).where(eq(crpValidationQueue.id, queueId)),
    );
    expect(queueRows[0]!.status).toBe('pending');
    expect(queueRows[0]!.decidedAt).toBeNull();
    expect(queueRows[0]!.decidedBy).toBeNull();

    // Profile still active (was active before and after).
    const profiles = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, userId)),
    );
    expect(profiles[0]!.status).toBe('active');

    expect(infoSpy).not.toHaveBeenCalled();
    // The rollback path logs WARN with the rollback diagnostic.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      event: 'crp_validation_decided',
      decision: 'approve_rolled_back',
      reason: 'invalid_transition',
    });
  });
});
