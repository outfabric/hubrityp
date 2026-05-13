import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { whatsappAccounts } from '@/shared/db/schema/whatsapp/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

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

function makeAccountValues(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    provider: 'twilio' as const,
    accountId: `MG${randomUUID().replace(/-/g, '')}`,
    phoneNumber: '+5511999999999',
    displayName: 'Dra. Teste',
    status: 'active' as const,
    consentGivenAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappAccounts);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// whatsapp_accounts — CRUD operations
// ---------------------------------------------------------------------------

describe('whatsapp_accounts — insert and query', () => {
  it('inserts a whatsapp_account with valid data', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      const [inserted] = await db
        .insert(whatsappAccounts)
        .values(makeAccountValues(userId))
        .returning();

      expect(inserted).toBeDefined();
      expect(inserted!.userId).toBe(userId);
      expect(inserted!.provider).toBe('twilio');
      expect(inserted!.status).toBe('active');
      expect(inserted!.consentGivenAt).toBeInstanceOf(Date);
      expect(inserted!.displayName).toBe('Dra. Teste');
    });
  });

  it('UNIQUE constraint blocks second insert for same user_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(whatsappAccounts).values(makeAccountValues(userId));
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappAccounts).values(
          makeAccountValues(userId, { accountId: 'MG_second_account' }),
        );
      }),
    ).rejects.toThrow();
  });

  it('get account returns the correct row', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const accountId = `MG${randomUUID().replace(/-/g, '')}`;

    await runAsService(async (db) => {
      await db.insert(whatsappAccounts).values(
        makeAccountValues(userId, { accountId }),
      );
    });

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(whatsappAccounts)
        .where(eq(whatsappAccounts.userId, userId))
        .limit(1);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.accountId).toBe(accountId);
    expect(rows[0]!.phoneNumber).toBe('+5511999999999');
  });
});

// ---------------------------------------------------------------------------
// whatsapp_accounts — disconnect (soft delete)
// ---------------------------------------------------------------------------

describe('whatsapp_accounts — disconnect', () => {
  it('disconnect changes status to disconnected but preserves the row', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(whatsappAccounts).values(makeAccountValues(userId));
    });

    // Disconnect
    await runAsService(async (db) => {
      await db
        .update(whatsappAccounts)
        .set({ status: 'disconnected', updatedAt: dsql`now()` })
        .where(eq(whatsappAccounts.userId, userId));
    });

    // Verify row still exists with updated status
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(whatsappAccounts)
        .where(eq(whatsappAccounts.userId, userId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('disconnected');
  });
});

// ---------------------------------------------------------------------------
// whatsapp_accounts — RLS cross-user isolation
// ---------------------------------------------------------------------------

describe('whatsapp_accounts — RLS', () => {
  it('psychologist A cannot see account of psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    // Insert accounts as service role (bypass RLS)
    await runAsService(async (db) => {
      await db.insert(whatsappAccounts).values(makeAccountValues(userIdA));
      await db.insert(whatsappAccounts).values(
        makeAccountValues(userIdB, { phoneNumber: '+5511888888888' }),
      );
    });

    // User A queries — should only see their own account
    const rowsA = await runAsUser(userIdA, async (db) => {
      return db.select().from(whatsappAccounts);
    });

    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]!.userId).toBe(userIdA);

    // User B queries — should only see their own account
    const rowsB = await runAsUser(userIdB, async (db) => {
      return db.select().from(whatsappAccounts);
    });

    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.userId).toBe(userIdB);
  });

  it('psychologist A cannot update account of psychologist B', async () => {
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await seedAuthUser(userIdA);
    await seedAuthUser(userIdB);

    await runAsService(async (db) => {
      await db.insert(whatsappAccounts).values(makeAccountValues(userIdB));
    });

    // User A tries to update user B's account — should affect 0 rows
    const result = await runAsUser(userIdA, async (db) => {
      return db
        .update(whatsappAccounts)
        .set({ status: 'disconnected' })
        .where(eq(whatsappAccounts.userId, userIdB))
        .returning();
    });

    expect(result).toHaveLength(0);

    // Verify B's account is unchanged
    const rowsB = await runAsService(async (db) => {
      return db
        .select({ status: whatsappAccounts.status })
        .from(whatsappAccounts)
        .where(eq(whatsappAccounts.userId, userIdB));
    });

    expect(rowsB[0]!.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// whatsapp_accounts — CHECK constraints
// ---------------------------------------------------------------------------

describe('whatsapp_accounts — CHECK constraints', () => {
  it('CHECK constraint rejects invalid provider', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO whatsapp_accounts (id, user_id, provider, account_id, phone_number, status, consent_given_at)
               VALUES (${randomUUID()}, ${userId}, 'z_api', 'acct_123', '+5511999999999', 'active', now())`,
        );
      }),
    ).rejects.toThrow();
  });

  it('CHECK constraint rejects invalid status', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO whatsapp_accounts (id, user_id, provider, account_id, phone_number, status, consent_given_at)
               VALUES (${randomUUID()}, ${userId}, 'twilio', 'acct_123', '+5511999999999', 'suspended', now())`,
        );
      }),
    ).rejects.toThrow();
  });
});
