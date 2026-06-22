import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { readOnboardingSummaryFromData } from '@/modules/onboarding';
import { locations } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// readOnboardingSummaryFromData — real Postgres (Testcontainers)
//
// Task 5.8 (rework-onboarding-first-run): the step-4 ("Pronto") summary derives
// from AUTHORITATIVE DOMAIN DATA — the same recompute source as the dashboard
// checklist — NOT the stored `onboarding_checklist` flags. This proves parity:
// a location (or patient) created OUTSIDE the wizard is reflected in the summary
// even though the stored flag was never flipped by the wizard.
//
// The impl authenticates via a fake Supabase client and reads/writes through the
// module-level Drizzle client (RLS-bypassing superuser in the container), with
// ownership enforced via `auth.uid()` exactly like the production service-role
// connection.
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  const meta = JSON.stringify({
    fullName: 'Test Psychologist',
    crpNumber: userId.slice(0, 6),
    crpUf: 'SP',
    termsAcceptedAt: '2026-01-01T00:00:00Z',
    privacyAcceptedAt: '2026-01-01T00:00:00Z',
    sensitiveDataConsentAt: '2026-01-01T00:00:00Z',
  });
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`},
                   '{"provider":"email"}'::jsonb, ${meta}::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof readOnboardingSummaryFromData>[0];
}

beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

describe('readOnboardingSummaryFromData (wizard step 4 summary)', () => {
  it('returns all-false for an unauthenticated session', async () => {
    const summary = await readOnboardingSummaryFromData(fakeSupabaseClient(null));
    expect(summary).toEqual({
      profileCompleted: false,
      locationConfigured: false,
      firstPatientAdded: false,
    });
  });

  it('reflects a location created OUTSIDE the wizard (parity with the dashboard checklist)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // A location created in Configurações — never via the wizard, so the stored
    // `onboarding_checklist.location_configured` flag was never flipped.
    await runAsService(async (db) => {
      await db.insert(locations).values({ userId, name: 'Consultório A', type: 'in_person' });
    });

    const summary = await readOnboardingSummaryFromData(fakeSupabaseClient(userId));

    // Derived from real data: profile satisfied (full_name set at signup),
    // location satisfied (the externally-created row), patients still missing.
    expect(summary.profileCompleted).toBe(true);
    expect(summary.locationConfigured).toBe(true);
    expect(summary.firstPatientAdded).toBe(false);
  });

  it('reflects an active patient created OUTSIDE the wizard', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({ userId, fullName: 'Paciente X', status: 'active' });
    });

    const summary = await readOnboardingSummaryFromData(fakeSupabaseClient(userId));
    expect(summary.firstPatientAdded).toBe(true);
    expect(summary.locationConfigured).toBe(false);
  });

  it("owner-scoped: another user's location does not satisfy the summary", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    await seedAuthUser(owner);
    await seedAuthUser(other);

    await runAsService(async (db) => {
      await db.insert(locations).values({ userId: other, name: 'Consultório B', type: 'online' });
    });

    const summary = await readOnboardingSummaryFromData(fakeSupabaseClient(owner));
    expect(summary.locationConfigured).toBe(false);
  });
});
