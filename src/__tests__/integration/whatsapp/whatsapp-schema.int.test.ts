import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { patients } from '@/shared/db/schema/patients/tables';
import { messageTemplates, whatsappAccounts } from '@/shared/db/schema/whatsapp/tables';

import { runAsService } from '../setup/run-as-service';

// Helper: create a row in `auth.users` so FK constraints are satisfied.
async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(messageTemplates);
    await db.delete(whatsappAccounts);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// whatsapp_accounts — table existence, RLS, constraints
// ---------------------------------------------------------------------------

describe('whatsapp_accounts table — schema verification', () => {
  it('table whatsapp_accounts exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'whatsapp_accounts'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('RLS is enabled on whatsapp_accounts', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'whatsapp_accounts'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

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

  it('UNIQUE(user_id) prevents duplicate accounts for the same user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(whatsappAccounts).values({
        userId,
        provider: 'twilio',
        accountId: 'acct_001',
        phoneNumber: '+5511999999999',
        status: 'active',
        consentGivenAt: new Date(),
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappAccounts).values({
          userId,
          provider: 'twilio',
          accountId: 'acct_002',
          phoneNumber: '+5511888888888',
          status: 'active',
          consentGivenAt: new Date(),
        });
      }),
    ).rejects.toThrow();
  });

  it('FK constraint with auth.users works — rejects invalid user_id', async () => {
    const fakeUserId = randomUUID(); // not in auth.users

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappAccounts).values({
          userId: fakeUserId,
          provider: 'twilio',
          accountId: 'acct_orphan',
          phoneNumber: '+5511999999999',
          status: 'active',
          consentGivenAt: new Date(),
        });
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// message_templates — table existence, RLS, constraints
// ---------------------------------------------------------------------------

describe('message_templates table — schema verification', () => {
  it('table message_templates exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'message_templates'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('RLS is enabled on message_templates', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'message_templates'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('CHECK constraint rejects invalid meta_status', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO message_templates (id, user_id, template_key, body, meta_status)
               VALUES (${randomUUID()}, ${userId}, 'lembrete_24h', 'Hello {{name}}', 'expired')`,
        );
      }),
    ).rejects.toThrow();
  });

  it('CHECK constraint rejects invalid template_key', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO message_templates (id, user_id, template_key, body)
               VALUES (${randomUUID()}, ${userId}, 'invalido', 'Hello')`,
        );
      }),
    ).rejects.toThrow();
  });

  it('UNIQUE(user_id, template_key) prevents duplicate templates', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(messageTemplates).values({
        userId,
        templateKey: 'lembrete_24h',
        body: 'Template v1',
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(messageTemplates).values({
          userId,
          templateKey: 'lembrete_24h',
          body: 'Template v2',
        });
      }),
    ).rejects.toThrow();
  });

  it('FK constraint with auth.users works — rejects invalid user_id', async () => {
    const fakeUserId = randomUUID(); // not in auth.users

    await expect(
      runAsService(async (db) => {
        await db.insert(messageTemplates).values({
          userId: fakeUserId,
          templateKey: 'lembrete_24h',
          body: 'Orphan template',
        });
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// patients — opt-out columns exist with correct defaults
// ---------------------------------------------------------------------------

describe('patients table — WhatsApp opt-out columns', () => {
  it('whatsapp_opt_out column exists and defaults to false', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Opt-Out Test',
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.whatsappOptOut).toBe(false);
  });

  it('whatsapp_opt_out_at column exists and defaults to null', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'OptOut At Test',
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.whatsappOptOutAt).toBeNull();
  });

  it('reminder_phone column exists and defaults to null', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Reminder Phone Test',
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.reminderPhone).toBeNull();
  });

  it('opt-out columns accept non-default values', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const optOutDate = new Date('2025-06-01T12:00:00Z');
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Explicit Opt-Out',
        whatsappOptOut: true,
        whatsappOptOutAt: optOutDate,
        reminderPhone: '+5511987654321',
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.whatsappOptOut).toBe(true);
    expect(row.whatsappOptOutAt).toBeInstanceOf(Date);
    expect(row.whatsappOptOutAt!.toISOString()).toBe(optOutDate.toISOString());
    expect(row.reminderPhone).toBe('+5511987654321');
  });
});
