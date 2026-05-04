import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { authLogs } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

import { signupInputFactory } from './factories/signup-input';

// Functional coverage for the `auth_logs` RLS policies. The user-side
// surface is intentionally narrow: SELECT only, scoped to
// `auth.uid() = user_id`. INSERT/UPDATE/DELETE have NO user-facing
// policy — only the service role (the `logAuthEvent` writer) can write.

async function seedUserAndLog(eventName: string): Promise<{ userId: string; logId: string }> {
  const userId = randomUUID();
  const email = signupInputFactory.uniqueEmail();
  const meta = {
    fullName: 'Maria Silva',
    crpNumber: signupInputFactory.uniqueCrpNumber(),
    crpUf: 'SP',
    termsAcceptedAt: new Date().toISOString(),
    privacyAcceptedAt: new Date().toISOString(),
    sensitiveDataConsentAt: new Date().toISOString(),
  };

  let logId = '';
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${userId}, ${email}, ${JSON.stringify(
        meta,
      )}::jsonb)`,
    );
    const [row] = await db
      .insert(authLogs)
      .values({ userId, event: eventName, metadata: { seed: true } })
      .returning({ id: authLogs.id });
    logId = row!.id;
  });

  return { userId, logId };
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM auth.users`);
    await db.execute(dsql`DELETE FROM auth_logs`);
  });
});

describe('auth_logs RLS policies (integration)', () => {
  it('userA SELECT only returns their own log rows', async () => {
    const a = await seedUserAndLog('signup_success');
    const b = await seedUserAndLog('signup_success');

    // Sanity: service role sees both log rows.
    const allLogs = await runAsService(async (db) => db.select().from(authLogs));
    expect(allLogs).toHaveLength(2);

    // userA's RLS-scoped session sees only their own.
    const aVisible = await runAsUser(a.userId, async (db) => db.select().from(authLogs));
    expect(aVisible).toHaveLength(1);
    expect(aVisible[0]!.userId).toBe(a.userId);

    // Defensive: userB's session never returns A's row even when
    // explicitly filtering by A's log id (RLS hides the row entirely).
    const aFromB = await runAsUser(b.userId, async (db) =>
      db.select().from(authLogs).where(eq(authLogs.id, a.logId)),
    );
    expect(aFromB).toHaveLength(0);
  });

  it('logs with userId NULL (e.g. signup_failure_duplicate_email) are NOT visible to authenticated users', async () => {
    // Anonymous-attempt audit rows: userId is null because no
    // auth.users row exists yet. RLS uses `auth.uid() = user_id` —
    // null is never equal to any uuid, so these rows are invisible to
    // every user-side session.
    await runAsService(async (db) => {
      await db.insert(authLogs).values({
        userId: null,
        event: 'signup_failure_duplicate_email',
        metadata: { emailHash: 'abc' },
      });
    });

    const someUser = await seedUserAndLog('signup_success');
    const nullLogVisible = await runAsUser(someUser.userId, async (db) =>
      db.select().from(authLogs).where(eq(authLogs.event, 'signup_failure_duplicate_email')),
    );
    expect(nullLogVisible).toHaveLength(0);
  });

  it('direct INSERT into auth_logs by an authenticated user is blocked', async () => {
    const a = await seedUserAndLog('signup_success');

    // No INSERT policy exists for end-users. Even targeting their own
    // user_id should be denied at the RLS layer.
    let caught: unknown = null;
    try {
      await runAsUser(a.userId, async (db) => {
        await db.insert(authLogs).values({
          userId: a.userId,
          event: 'forged_event',
          metadata: { tampered: true },
        });
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);

    // The behavioural contract is "no `forged_event` row landed". RLS
    // / privilege denial may surface either as a thrown error or as a
    // silent zero-row write depending on the policy set; asserting the
    // database state nails the user-visible outcome.
    const forged = await runAsService(async (db) =>
      db.select().from(authLogs).where(eq(authLogs.event, 'forged_event')),
    );
    expect(forged).toHaveLength(0);
  });

  it('service-role connection bypasses RLS — writes audit rows on behalf of every user', async () => {
    // This is exactly what `logAuthEvent` does in production. We don't
    // call the function directly here (its `next/headers` capture is
    // exercised in `sign-up.int.test.ts`); we just assert the policy
    // surface allows a service-role write of any shape.
    const userId = randomUUID();
    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (${userId}, 'svc@test.local', '{"fullName":"Maria Silva","crpNumber":"06/000001","crpUf":"SP","termsAcceptedAt":"2024-01-01T00:00:00Z","privacyAcceptedAt":"2024-01-01T00:00:00Z","sensitiveDataConsentAt":"2024-01-01T00:00:00Z"}'::jsonb)`,
      );
      await db.insert(authLogs).values({ userId, event: 'signup_success', metadata: {} });
    });

    const rows = await runAsService(async (db) =>
      db.select().from(authLogs).where(eq(authLogs.userId, userId)),
    );
    expect(rows).toHaveLength(1);
  });
});
