import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  getNotificationPreferencesForOwner,
  updateNotificationPreferencesImpl,
} from '@/modules/notifications';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Insert an `auth.users` row. The `handle_new_user()` SECURITY DEFINER trigger
// materializes the matching `public.profiles` row from `raw_user_meta_data`, so
// the required metadata fields MUST be present.
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

interface RawPrefRow {
  user_id: string;
  email_daily: boolean;
  email_weekly: boolean;
  email_critical: boolean;
  in_app_sound: boolean;
}

async function readPrefRow(userId: string): Promise<RawPrefRow | null> {
  const rows = await runAsService((db) =>
    db.execute(
      dsql`SELECT user_id, email_daily, email_weekly, email_critical, in_app_sound
           FROM notification_preferences WHERE user_id = ${userId}`,
    ),
  );
  return (rows[0] as RawPrefRow | undefined) ?? null;
}

async function countPrefRows(userId: string): Promise<number> {
  const rows = await runAsService((db) =>
    db.execute(
      dsql`SELECT COUNT(*)::int AS n FROM notification_preferences WHERE user_id = ${userId}`,
    ),
  );
  return (rows[0] as { n: number }).n;
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- static fake
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as Parameters<typeof updateNotificationPreferencesImpl>[0];
}

// ---------------------------------------------------------------------------
// Cleanup — `notification_preferences` cascades from auth.users (ON DELETE
// CASCADE), and cleanTestData() deletes the seeded test-* users.
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateNotificationPreferencesImpl — real Postgres', () => {
  it('returns UNAUTHORIZED when there is no session', async () => {
    const result = await updateNotificationPreferencesImpl(fakeSupabaseClient(null), {
      emailDaily: false,
      emailWeekly: false,
      inAppSound: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns INVALID_INPUT for a malformed body and writes nothing', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await updateNotificationPreferencesImpl(fakeSupabaseClient(userId), {
      emailDaily: 'yes', // not a boolean
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');

    // No row materialized from a rejected request.
    expect(await countPrefRows(userId)).toBe(0);
  });

  it('happy path: creates the owner row then updates it on a second call', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // First save (INSERT branch of the upsert).
    const created = await updateNotificationPreferencesImpl(fakeSupabaseClient(userId), {
      emailDaily: false,
      emailWeekly: true,
      inAppSound: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.preferences).toEqual({
      emailDaily: false,
      emailWeekly: true,
      emailCritical: true,
      inAppSound: false,
    });
    expect(await countPrefRows(userId)).toBe(1);

    // Second save (UPDATE branch) — still exactly one row, values changed.
    const updated = await updateNotificationPreferencesImpl(fakeSupabaseClient(userId), {
      emailDaily: true,
      emailWeekly: false,
      inAppSound: true,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(await countPrefRows(userId)).toBe(1);

    const row = await readPrefRow(userId);
    expect(row).not.toBeNull();
    expect(row?.email_daily).toBe(true);
    expect(row?.email_weekly).toBe(false);
    expect(row?.in_app_sound).toBe(true);
  });

  it('coerces email_critical to TRUE even when the client tries to disable it', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // The schema strips unknown keys, so `emailCritical: false` never reaches
    // the persistence layer — the server always writes TRUE.
    const result = await updateNotificationPreferencesImpl(fakeSupabaseClient(userId), {
      emailDaily: false,
      emailWeekly: false,
      inAppSound: false,
      emailCritical: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preferences.emailCritical).toBe(true);

    const row = await readPrefRow(userId);
    expect(row?.email_critical).toBe(true);
  });

  it('is owner-scoped: a cross-user payload cannot touch another user’s row', async () => {
    const victim = randomUUID();
    const attacker = randomUUID();
    await seedAuthUser(victim);
    await seedAuthUser(attacker);

    // Victim establishes a baseline row.
    const baseline = await updateNotificationPreferencesImpl(fakeSupabaseClient(victim), {
      emailDaily: true,
      emailWeekly: true,
      inAppSound: true,
    });
    expect(baseline.ok).toBe(true);

    // Attacker (authenticated as themselves) submits a payload that *names* the
    // victim's id — the action MUST ignore any client-supplied id and write
    // only the attacker's own row.
    const result = await updateNotificationPreferencesImpl(fakeSupabaseClient(attacker), {
      userId: victim, // ignored — authorization is from the session
      emailDaily: false,
      emailWeekly: false,
      inAppSound: false,
    });
    expect(result.ok).toBe(true);

    // Victim's row is untouched.
    const victimRow = await readPrefRow(victim);
    expect(victimRow?.email_daily).toBe(true);
    expect(victimRow?.email_weekly).toBe(true);
    expect(victimRow?.in_app_sound).toBe(true);

    // Attacker's own row reflects their submission.
    const attackerRow = await readPrefRow(attacker);
    expect(attackerRow?.email_daily).toBe(false);
    expect(attackerRow?.email_weekly).toBe(false);
    expect(attackerRow?.in_app_sound).toBe(false);

    // Exactly one row each — no cross-write created or clobbered a row.
    expect(await countPrefRows(victim)).toBe(1);
    expect(await countPrefRows(attacker)).toBe(1);
  });

  it('getNotificationPreferencesForOwner returns defaults before any save and the persisted view after', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const before = await getNotificationPreferencesForOwner(fakeSupabaseClient(userId));
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.preferences).toEqual({
      emailDaily: true,
      emailWeekly: true,
      emailCritical: true,
      inAppSound: true,
    });

    await updateNotificationPreferencesImpl(fakeSupabaseClient(userId), {
      emailDaily: false,
      emailWeekly: false,
      inAppSound: false,
    });

    const after = await getNotificationPreferencesForOwner(fakeSupabaseClient(userId));
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.preferences).toEqual({
      emailDaily: false,
      emailWeekly: false,
      emailCritical: true,
      inAppSound: false,
    });
  });
});
