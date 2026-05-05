import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { oauthIdentities } from '@/shared/db/schema/auth/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// RLS coverage for `oauth_identities`:
//   - SELECT: user can only see their own rows (oauth_identities_select_own)
//   - INSERT/UPDATE/DELETE: no policy for end-users — blocked
//   - service_role: bypasses RLS entirely

async function createUserWithIdentity(
  provider = 'google',
): Promise<{ userId: string; identityId: string }> {
  const userId = randomUUID();
  const email = `${randomUUID().replace(/-/g, '')}@test.local`;
  let identityId = '';

  await runAsService(async (db) => {
    // Use raw_app_meta_data with the OAuth provider so the trigger skips
    // profile creation (no fullName/crp metadata needed for OAuth users).
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${email}, ${JSON.stringify({ provider })}::jsonb)`,
    );
    const [row] = await db
      .insert(oauthIdentities)
      .values({
        userId,
        provider,
        providerUserId: `${provider}-${randomUUID()}`,
        isPrimary: true,
      })
      .returning({ id: oauthIdentities.id });
    identityId = row!.id;
  });

  return { userId, identityId };
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(dsql`DELETE FROM oauth_identities`);
    await db.execute(dsql`DELETE FROM auth.users`);
  });
});

describe('oauth_identities RLS policies (integration)', () => {
  it('userA cannot see identities belonging to userB', async () => {
    const a = await createUserWithIdentity('google');
    const b = await createUserWithIdentity('github');

    // Service role sees both
    const all = await runAsService(async (db) => db.select().from(oauthIdentities));
    expect(all).toHaveLength(2);

    // userA only sees their own
    const aVisible = await runAsUser(a.userId, async (db) => db.select().from(oauthIdentities));
    expect(aVisible).toHaveLength(1);
    expect(aVisible[0]!.userId).toBe(a.userId);
    expect(aVisible[0]!.provider).toBe('google');

    // userB only sees their own
    const bVisible = await runAsUser(b.userId, async (db) => db.select().from(oauthIdentities));
    expect(bVisible).toHaveLength(1);
    expect(bVisible[0]!.userId).toBe(b.userId);
    expect(bVisible[0]!.provider).toBe('github');

    // userA explicitly querying B's identity gets nothing
    const cross = await runAsUser(a.userId, async (db) =>
      db.select().from(oauthIdentities).where(eq(oauthIdentities.id, b.identityId)),
    );
    expect(cross).toHaveLength(0);
  });

  it('direct INSERT into oauth_identities by an authenticated user is blocked', async () => {
    const a = await createUserWithIdentity('google');

    let caught: unknown = null;
    try {
      await runAsUser(a.userId, async (db) => {
        await db.insert(oauthIdentities).values({
          userId: a.userId,
          provider: 'forged_provider',
          providerUserId: 'forged-id',
          isPrimary: false,
        });
      });
    } catch (err) {
      caught = err;
    }

    // Either error thrown or row not created — we check both
    expect(caught).toBeInstanceOf(Error);

    const forged = await runAsService(async (db) =>
      db.select().from(oauthIdentities).where(eq(oauthIdentities.provider, 'forged_provider')),
    );
    expect(forged).toHaveLength(0);
  });

  it('direct UPDATE by authenticated user is blocked (no UPDATE policy)', async () => {
    const a = await createUserWithIdentity('google');

    try {
      await runAsUser(a.userId, async (db) => {
        await db
          .update(oauthIdentities)
          .set({ provider: 'tampered' })
          .where(eq(oauthIdentities.id, a.identityId));
      });
    } catch {
      // Either an error was thrown (RLS deny) or the update silently did
      // nothing. Both are acceptable RLS outcomes — the key is the row is
      // unchanged. We verify state below.
    }

    // Verify the row was not actually changed
    const [row] = await runAsService(async (db) =>
      db.select().from(oauthIdentities).where(eq(oauthIdentities.id, a.identityId)),
    );
    expect(row!.provider).toBe('google');
  });

  it('direct DELETE by authenticated user is blocked (no DELETE policy)', async () => {
    const a = await createUserWithIdentity('google');

    try {
      await runAsUser(a.userId, async (db) => {
        await db.delete(oauthIdentities).where(eq(oauthIdentities.id, a.identityId));
      });
    } catch {
      // RLS may throw or silently no-op. Either way, we verify state below.
    }

    // Verify the row still exists
    const [row] = await runAsService(async (db) =>
      db.select().from(oauthIdentities).where(eq(oauthIdentities.id, a.identityId)),
    );
    expect(row).toBeDefined();
    expect(row!.provider).toBe('google');
  });

  it('service role bypasses RLS — reads and writes all rows', async () => {
    const a = await createUserWithIdentity('google');
    await createUserWithIdentity('github');

    // Service role sees everything
    const all = await runAsService(async (db) => db.select().from(oauthIdentities));
    expect(all).toHaveLength(2);

    // Service role can write
    await runAsService(async (db) => {
      await db.insert(oauthIdentities).values({
        userId: a.userId,
        provider: 'microsoft',
        providerUserId: `ms-${randomUUID()}`,
        isPrimary: false,
      });
    });

    const afterInsert = await runAsService(async (db) =>
      db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, a.userId)),
    );
    expect(afterInsert).toHaveLength(2); // google + microsoft
  });
});
