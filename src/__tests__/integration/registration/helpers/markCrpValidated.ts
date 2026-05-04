import { eq, sql } from 'drizzle-orm';

import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { profiles } from '@/shared/db/schema/auth/tables';

// Test-only helper that flips a `profiles` row to `active` by setting
// `status` and stamping `crp_validated_at`. This mirrors the production
// path that an admin (out-of-scope for this change) would take to
// promote a `pending_crp_validation` profile to active.
//
// The helper goes through `runAsService` (RLS-bypass) because in
// production the writer is the service-role/admin path; end-users have
// SELECT/UPDATE policies on `profiles` but transitioning the lifecycle
// status is not something a user can self-serve.
//
// `crp_validated_by` is intentionally left null — the admin-domain entity
// is out of scope for the auth-account-creation change. Tests that need
// to assert the validator id can extend this helper later.
export async function markCrpValidated(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db
      .update(profiles)
      .set({
        status: 'active',
        crpValidatedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(profiles.userId, userId));
  });
}
