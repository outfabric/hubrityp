import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { profiles } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

import { signupInputFactory } from './factories/signup-input';

// Functional coverage for the `profiles` RLS policies installed by the
// section-2 migration. The `policy-coverage` lint test only checks
// that policies exist; this test exercises them — userA cannot read
// or update userB's row, direct INSERT is blocked for end-users, and
// the service-role connection bypasses RLS entirely.

async function createProfile(): Promise<{ userId: string; email: string; crpNumber: string }> {
  const userId = randomUUID();
  const email = signupInputFactory.uniqueEmail();
  const crpNumber = signupInputFactory.uniqueCrpNumber();
  const meta = {
    fullName: 'Maria Silva',
    crpNumber,
    crpUf: 'SP',
    termsAcceptedAt: new Date().toISOString(),
    privacyAcceptedAt: new Date().toISOString(),
    sensitiveDataConsentAt: new Date().toISOString(),
  };

  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${userId}, ${email}, ${JSON.stringify(
        meta,
      )}::jsonb)`,
    );
  });

  return { userId, email, crpNumber };
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

describe('profiles RLS policies (integration)', () => {
  it('userA SELECT-ing profiles only returns their own row', async () => {
    const a = await createProfile();
    const b = await createProfile();

    // Sanity: as service-role both rows exist.
    const allRows = await runAsService(async (db) => db.select().from(profiles));
    expect(allRows).toHaveLength(2);

    // From userA's RLS-scoped session, only userA's row is visible.
    const visible = await runAsUser(a.userId, async (db) => db.select().from(profiles));
    expect(visible).toHaveLength(1);
    expect(visible[0]!.userId).toBe(a.userId);
    expect(visible[0]!.email).toBe(a.email);

    // The same query from userB sees only B.
    const visibleToB = await runAsUser(b.userId, async (db) => db.select().from(profiles));
    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0]!.userId).toBe(b.userId);
  });

  it("userA UPDATE on userB's row affects 0 rows", async () => {
    const a = await createProfile();
    const b = await createProfile();

    // The UPDATE policy's USING clause filters rows BEFORE the SET
    // applies. Drizzle returns the affected rows array — empty means
    // RLS hid the target.
    const updated = await runAsUser(a.userId, async (db) =>
      db
        .update(profiles)
        .set({ fullName: 'TAMPERED' })
        .where(eq(profiles.userId, b.userId))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    // userB's row was not actually changed.
    const [bRow] = await runAsService(async (db) =>
      db.select().from(profiles).where(eq(profiles.userId, b.userId)),
    );
    expect(bRow!.fullName).not.toBe('TAMPERED');
  });

  it('userA can UPDATE their own row', async () => {
    const a = await createProfile();

    const updated = await runAsUser(a.userId, async (db) =>
      db
        .update(profiles)
        .set({ fullName: 'Atualizada Silva' })
        .where(eq(profiles.userId, a.userId))
        .returning(),
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]!.fullName).toBe('Atualizada Silva');
  });

  it('direct INSERT into profiles by an authenticated user is blocked (no INSERT policy)', async () => {
    const a = await createProfile();
    const evilUserId = randomUUID();

    // Try to insert a SECOND profile row for some other user_id from
    // userA's session. There is NO INSERT policy on `profiles` (only
    // the SECURITY DEFINER trigger writes), so RLS denies the write.
    // The behavioural contract: either the call throws OR the row
    // does not land. We assert both ends — the call-site outcome
    // AND the database state — so a future refactor that swallows
    // the error elsewhere still trips this test.
    let caught: unknown = null;
    try {
      await runAsUser(a.userId, async (db) => {
        await db.execute(
          dsql`INSERT INTO profiles (
            user_id, email, full_name, crp_number, crp_uf, status,
            terms_accepted_at, privacy_accepted_at, sensitive_data_consent_at
          ) VALUES (
            ${evilUserId}, 'evil@x.com', 'Evil', '06/999998', 'SP',
            'pending_verification', now(), now(), now()
          )`,
        );
      });
    } catch (err) {
      caught = err;
    }

    // Either an error was thrown (RLS deny / privilege deny) OR — in
    // case some Postgres versions silently no-op the write — at least
    // verify the row is NOT visible from a service-role lookup.
    expect(caught).toBeInstanceOf(Error);

    const evilRow = await runAsService(async (db) =>
      db.select().from(profiles).where(eq(profiles.userId, evilUserId)),
    );
    expect(evilRow).toHaveLength(0);
  });

  it('service-role connection bypasses RLS — sees and writes all rows', async () => {
    await createProfile();
    await createProfile();

    // The integration `runAsService` opens a connection as the
    // postgres superuser, which is RLS-exempt. Both rows are visible.
    const rows = await runAsService(async (db) => db.select().from(profiles));
    expect(rows).toHaveLength(2);
  });
});
