import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';

import {
  seedActiveUser,
  seedCancelledUser,
  seedPendingCrpUser,
  seedPendingVerificationUser,
  seedSuspendedUser,
} from './users';

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(crpValidationQueue);
    await db.delete(psychologistProfiles);
    await db.execute(sql`DELETE FROM auth.users`);
  });
});

// Smoke-tests for the lifecycle-driven user factories. The deeper transition
// behaviour is covered by `applyTransition`'s own integration tests; here we
// only verify that each factory chain lands the profile on the documented
// terminal status. This catches:
//   • a state-machine refactor that breaks one of the chains.
//   • a typo in a factory that would otherwise surface as a confusing
//     downstream test failure.
describe('users factory (integration)', () => {
  it('seedPendingVerificationUser leaves the profile at pending_verification', async () => {
    const seeded = await seedPendingVerificationUser();

    const rows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, seeded.userId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending_verification');
  });

  it('seedPendingCrpUser advances the profile to pending_crp_validation', async () => {
    const seeded = await seedPendingCrpUser();

    const rows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, seeded.userId)),
    );
    expect(rows[0]!.status).toBe('pending_crp_validation');
  });

  it('seedActiveUser advances the profile to active', async () => {
    const seeded = await seedActiveUser();

    const rows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, seeded.userId)),
    );
    expect(rows[0]!.status).toBe('active');
  });

  it('seedSuspendedUser drives the rejection-at-review path to suspended', async () => {
    const seeded = await seedSuspendedUser();

    const rows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, seeded.userId)),
    );
    expect(rows[0]!.status).toBe('suspended');
  });

  it('seedCancelledUser drives active → user_cancel → cancelled', async () => {
    const seeded = await seedCancelledUser();

    const rows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, seeded.userId)),
    );
    expect(rows[0]!.status).toBe('cancelled');
  });

  it('produces unique CRP numbers across consecutive calls so UNIQUE collisions cannot occur', async () => {
    // The factory's default CRP is `06/<6-digit-random>` — over 100 calls the
    // probability of a collision is negligible, but the contract is that
    // the consumer can call several factories in a single test without the
    // (crp_number, crp_uf) UNIQUE constraint biting.
    const a = await seedPendingVerificationUser();
    const b = await seedPendingVerificationUser();
    expect(a.crpNumber).not.toBe(b.crpNumber);
  });

  it('honours overrides for crpNumber, crpUf, email, fullName, and userId', async () => {
    const fixedUserId = '00000000-0000-4000-8000-00000000000a';
    const seeded = await seedActiveUser({
      userId: fixedUserId,
      email: 'override@test.local',
      crpNumber: '06/999111',
      crpUf: 'RJ',
      fullName: 'Dra. Override',
    });

    expect(seeded.userId).toBe(fixedUserId);
    expect(seeded.email).toBe('override@test.local');
    expect(seeded.crpNumber).toBe('06/999111');
    expect(seeded.crpUf).toBe('RJ');
    expect(seeded.fullName).toBe('Dra. Override');

    const rows = await runAsService(async (db) =>
      db.select().from(psychologistProfiles).where(eq(psychologistProfiles.userId, fixedUserId)),
    );
    expect(rows[0]!.fullName).toBe('Dra. Override');
    expect(rows[0]!.crpNumber).toBe('06/999111');
    expect(rows[0]!.crpUf).toBe('RJ');
    expect(rows[0]!.status).toBe('active');
  });
});
