import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// `revalidatePath` requires a Next.js request scope that does not exist in the
// Testcontainers integration environment — stub it so the Server Action runs.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { fetchActivePsychologists } from '@/modules/whatsapp/inngest/reminders-dispatcher';
import { saveReminderSettingsImpl } from '@/modules/whatsapp/server/reminders/save-reminder-settings';
import { profiles } from '@/shared/db/schema/auth/tables';
import {
  messageTemplates,
  reminderSettings,
  whatsappAccounts,
} from '@/shared/db/schema/whatsapp/tables';

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

async function seedProfile(userId: string, fullName: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(profiles).values({
      userId,
      email: `test-${userId}@example.com`,
      fullName,
      crpNumber: '123456',
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
  });
}

/**
 * Minimal fake Supabase client returning a specific user for `auth.getUser()`.
 * Isolates the Server Action from real GoTrue (not running in Testcontainers).
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof saveReminderSettingsImpl>[0];
}

/** A valid consented first-save input. */
function consentedInput() {
  return {
    early_reminder_hours: 24,
    final_reminder_hours: 2,
    video_link_minutes: 30,
    send_during_night: false,
    consent: true as const,
  };
}

// ---------------------------------------------------------------------------
// Cleanup — whatsapp domain first (FK to auth.users), then auth.users
// (profiles cascade-delete with their owner).
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(messageTemplates);
    await db.delete(whatsappAccounts);
    await db.delete(reminderSettings);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ===========================================================================
// 3.5 — First consented save provisions account + templates; subsequent saves
// do not duplicate nor re-require consent.
// ===========================================================================

describe('saveReminderSettingsImpl — lazy provisioning on first consented save', () => {
  it('creates an active whatsapp_accounts row + templates + settings, scoped to the session user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dra. Ana Souza');

    const result = await saveReminderSettingsImpl(fakeSupabaseClient(userId), consentedInput());
    expect(result).toEqual({ ok: true });

    const accounts = await runAsService(async (db) => {
      return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.userId, userId));
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.status).toBe('active');
    expect(accounts[0]!.displayName).toBe('Dra. Ana Souza');
    expect(accounts[0]!.consentGivenAt).toBeInstanceOf(Date);
    // Provisioned from the platform number (integration global-setup default).
    expect(accounts[0]!.phoneNumber).toBe('+551140000000');

    const templates = await runAsService(async (db) => {
      return db.select().from(messageTemplates).where(eq(messageTemplates.userId, userId));
    });
    expect(templates).toHaveLength(6);

    const settings = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });
    expect(settings).toHaveLength(1);
    expect(settings[0]!.earlyReminderHours).toBe(24);
  });

  it('makes the psychologist visible to the reminders dispatcher after provisioning', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Bruno Lima');

    const before = await runAsService((db) => fetchActivePsychologists(db));
    expect(before.some((p) => p.userId === userId)).toBe(false);

    const result = await saveReminderSettingsImpl(fakeSupabaseClient(userId), consentedInput());
    expect(result).toEqual({ ok: true });

    const after = await runAsService((db) => fetchActivePsychologists(db));
    const psych = after.find((p) => p.userId === userId);
    expect(psych).toBeDefined();
    expect(psych!.displayName).toBe('Dr. Bruno Lima');
  });

  it('subsequent saves do not duplicate the account, do not re-require consent, and preserve consent_given_at', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dra. Carla Dias');

    const first = await saveReminderSettingsImpl(fakeSupabaseClient(userId), consentedInput());
    expect(first).toEqual({ ok: true });

    const [firstAccount] = await runAsService(async (db) => {
      return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.userId, userId));
    });
    const originalConsentAt = firstAccount!.consentGivenAt;

    // Second save WITHOUT a consent field — must be accepted (account exists).
    const second = await saveReminderSettingsImpl(fakeSupabaseClient(userId), {
      early_reminder_hours: 48,
      final_reminder_hours: 1,
      video_link_minutes: 60,
      send_during_night: true,
    });
    expect(second).toEqual({ ok: true });

    const accounts = await runAsService(async (db) => {
      return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.userId, userId));
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.consentGivenAt).toEqual(originalConsentAt);

    const settings = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });
    expect(settings[0]!.earlyReminderHours).toBe(48);
    expect(settings[0]!.sendDuringNight).toBe(true);
  });
});

// ===========================================================================
// 3.6 — Negative / security: no consent → no account; RLS isolation;
// concurrent first-saves settle on exactly one account.
// ===========================================================================

describe('saveReminderSettingsImpl — consent gate (no account provisioned without consent)', () => {
  it('rejects a first save without consent and creates neither an account nor a settings row', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dra. Dora Melo');

    const result = await saveReminderSettingsImpl(fakeSupabaseClient(userId), {
      early_reminder_hours: 24,
      final_reminder_hours: 2,
      video_link_minutes: 30,
      send_during_night: false,
      // consent intentionally absent
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_input');
    }

    const accounts = await runAsService(async (db) => {
      return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.userId, userId));
    });
    expect(accounts).toHaveLength(0);

    const settings = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });
    expect(settings).toHaveLength(0);
  });

  it('rejects consent: false and never provisions', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Elias Nunes');

    const result = await saveReminderSettingsImpl(fakeSupabaseClient(userId), {
      ...consentedInput(),
      consent: false,
    });

    expect(result.ok).toBe(false);

    const accounts = await runAsService(async (db) => {
      return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.userId, userId));
    });
    expect(accounts).toHaveLength(0);
  });
});

describe('whatsapp_accounts — RLS cross-user isolation', () => {
  it('a user cannot provision an account for another user_id (WITH CHECK)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await expect(
      runAsUser(userA, async (db) => {
        return db.insert(whatsappAccounts).values({
          userId: userB,
          provider: 'twilio',
          accountId: '+551140000000',
          phoneNumber: '+551140000000',
          status: 'active',
          consentGivenAt: new Date(),
        });
      }),
    ).rejects.toThrow();

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.userId, userB));
    });
    expect(rows).toHaveLength(0);
  });

  it('a user cannot read another user account', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA, 'Dra. Fátima Reis');

    // Provision A's account via the Server Action (service-scoped `db`).
    await saveReminderSettingsImpl(fakeSupabaseClient(userA), consentedInput());

    // B queries whatsapp_accounts under their own JWT — sees nothing.
    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(whatsappAccounts);
    });
    expect(rows).toHaveLength(0);
  });
});

describe('saveReminderSettingsImpl — concurrent first-saves', () => {
  it('two simultaneous first-saves settle on exactly one account with no unhandled 23505', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId, 'Dr. Gustavo Pinto');

    const client = fakeSupabaseClient(userId);
    const [a, b] = await Promise.all([
      saveReminderSettingsImpl(client, consentedInput()),
      saveReminderSettingsImpl(client, consentedInput()),
    ]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });

    const accounts = await runAsService(async (db) => {
      return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.userId, userId));
    });
    expect(accounts).toHaveLength(1);

    // Templates are seeded exactly once (only the insert winner seeds).
    const templates = await runAsService(async (db) => {
      return db.select().from(messageTemplates).where(eq(messageTemplates.userId, userId));
    });
    expect(templates).toHaveLength(6);
  });
});
