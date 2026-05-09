import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { getAgendaSettingsImpl } from '@/modules/agenda/server/get-agenda-settings';
import { saveAgendaSettingsImpl } from '@/modules/agenda/server/save-agenda-settings';
import { agendaSettings } from '@/shared/db/schema/agenda/tables';

import { runAsService } from '../setup/run-as-service';

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

/**
 * Build a minimal fake Supabase client that returns a specific user for
 * `auth.getUser()`. This isolates the server action logic from the real
 * Supabase Auth service (which requires GoTrue running).
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof getAgendaSettingsImpl>[0];
}

/** Valid input with Mon-Fri 09:00-18:00 business hours. */
function validInput(overrides?: Record<string, unknown>) {
  return {
    default_duration_minutes: 50,
    interval_minutes: 10,
    business_hours: [
      { day: 1, start: '09:00', end: '18:00' },
      { day: 2, start: '09:00', end: '18:00' },
      { day: 3, start: '09:00', end: '18:00' },
      { day: 4, start: '09:00', end: '18:00' },
      { day: 5, start: '09:00', end: '18:00' },
    ],
    ...overrides,
  };
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(agendaSettings);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// getAgendaSettingsImpl
// ---------------------------------------------------------------------------

describe('getAgendaSettingsImpl', () => {
  it('returns defaults when no row exists for the user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await getAgendaSettingsImpl(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isDefault).toBe(true);
    expect(result.settings.defaultDurationMinutes).toBe(50);
    expect(result.settings.intervalMinutes).toBe(10);
    expect(result.settings.cancellationPolicy).toBeNull();
    expect(result.settings.defaultColor).toBeNull();

    // Default business hours: Mon-Fri 08:00-20:00 + Sat 08:00-12:00
    const hours = result.settings.businessHours as Array<{
      day: number;
      start: string;
      end: string;
    }>;
    expect(hours).toHaveLength(6);
    expect(hours[0]).toEqual({ day: 1, start: '08:00', end: '20:00' });
    expect(hours[5]).toEqual({ day: 6, start: '08:00', end: '12:00' });
  });

  it('returns persisted settings after save', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Save custom settings
    await saveAgendaSettingsImpl(client, validInput({ default_duration_minutes: 60 }));

    const result = await getAgendaSettingsImpl(client);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isDefault).toBe(false);
    expect(result.settings.defaultDurationMinutes).toBe(60);
    expect(result.settings.intervalMinutes).toBe(10);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);

    const result = await getAgendaSettingsImpl(client);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// saveAgendaSettingsImpl
// ---------------------------------------------------------------------------

describe('saveAgendaSettingsImpl', () => {
  it('creates a new settings row (insert path)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await saveAgendaSettingsImpl(
      client,
      validInput({
        default_duration_minutes: 45,
        interval_minutes: 15,
        cancellation_policy: 'Cancele com 24h de antecedencia.',
        default_color: '#3B82F6',
      }),
    );

    expect(result.ok).toBe(true);

    // Verify row in DB
    const rows = await runAsService(async (db) => {
      return db.select().from(agendaSettings).where(eq(agendaSettings.userId, userId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.defaultDurationMinutes).toBe(45);
    expect(rows[0]!.intervalMinutes).toBe(15);
    expect(rows[0]!.cancellationPolicy).toBe('Cancele com 24h de antecedencia.');
    expect(rows[0]!.defaultColor).toBe('#3B82F6');

    const hours = rows[0]!.businessHours as Array<{
      day: number;
      start: string;
      end: string;
    }>;
    expect(hours).toHaveLength(5);
    expect(hours[0]).toEqual({ day: 1, start: '09:00', end: '18:00' });
  });

  it('updates an existing settings row (upsert path)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // First save
    await saveAgendaSettingsImpl(client, validInput({ default_duration_minutes: 50 }));

    // Second save with different values
    const result = await saveAgendaSettingsImpl(
      client,
      validInput({
        default_duration_minutes: 30,
        interval_minutes: 5,
        cancellation_policy: 'Politica atualizada.',
      }),
    );

    expect(result.ok).toBe(true);

    // Verify only one row exists (upsert, not duplicate insert)
    const rows = await runAsService(async (db) => {
      return db.select().from(agendaSettings).where(eq(agendaSettings.userId, userId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.defaultDurationMinutes).toBe(30);
    expect(rows[0]!.intervalMinutes).toBe(5);
    expect(rows[0]!.cancellationPolicy).toBe('Politica atualizada.');
  });

  it('returns invalid_input for duration below minimum', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await saveAgendaSettingsImpl(
      client,
      validInput({ default_duration_minutes: 5 }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
    if (result.error !== 'invalid_input') return;
    expect(result.fieldErrors).toHaveProperty('default_duration_minutes');
  });

  it('returns invalid_input for invalid business hours (end before start)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await saveAgendaSettingsImpl(client, {
      default_duration_minutes: 50,
      interval_minutes: 10,
      business_hours: [{ day: 1, start: '18:00', end: '08:00' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('returns invalid_input for empty input', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await saveAgendaSettingsImpl(client, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);

    const result = await saveAgendaSettingsImpl(client, validInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });
});

// ---------------------------------------------------------------------------
// RLS cross-user isolation
// ---------------------------------------------------------------------------

describe('RLS cross-user isolation', () => {
  it('psychologist A cannot read settings of psychologist B', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const clientA = fakeSupabaseClient(userA);
    const clientB = fakeSupabaseClient(userB);

    // Each user saves settings
    await saveAgendaSettingsImpl(clientA, validInput({ default_duration_minutes: 45 }));
    await saveAgendaSettingsImpl(clientB, validInput({ default_duration_minutes: 60 }));

    // User A should only see their own settings
    const resultA = await getAgendaSettingsImpl(clientA);
    expect(resultA.ok).toBe(true);
    if (!resultA.ok) return;
    expect(resultA.isDefault).toBe(false);
    if (resultA.isDefault) return;
    expect(resultA.settings.defaultDurationMinutes).toBe(45);

    // User B should only see their own settings
    const resultB = await getAgendaSettingsImpl(clientB);
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.isDefault).toBe(false);
    if (resultB.isDefault) return;
    expect(resultB.settings.defaultDurationMinutes).toBe(60);
  });

  it('psychologist A saving does not overwrite psychologist B settings', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const clientA = fakeSupabaseClient(userA);
    const clientB = fakeSupabaseClient(userB);

    // B saves first
    await saveAgendaSettingsImpl(clientB, validInput({ default_duration_minutes: 60 }));

    // A saves — should not affect B
    await saveAgendaSettingsImpl(clientA, validInput({ default_duration_minutes: 30 }));

    // Verify B's settings are unchanged
    const resultB = await getAgendaSettingsImpl(clientB);
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.isDefault).toBe(false);
    if (resultB.isDefault) return;
    expect(resultB.settings.defaultDurationMinutes).toBe(60);

    // Verify directly in DB — exactly 2 rows total
    const rows = await runAsService(async (db) => {
      return db.select().from(agendaSettings);
    });
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Full get → save → get → update → get lifecycle
// ---------------------------------------------------------------------------

describe('full lifecycle', () => {
  it('get (defaults) → save (create) → get → save (update) → get', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // 1. Get — should return defaults
    const first = await getAgendaSettingsImpl(client);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.isDefault).toBe(true);

    // 2. Save — creates row
    const saveResult = await saveAgendaSettingsImpl(
      client,
      validInput({ default_duration_minutes: 45 }),
    );
    expect(saveResult.ok).toBe(true);

    // 3. Get — should return saved values
    const second = await getAgendaSettingsImpl(client);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.isDefault).toBe(false);
    if (second.isDefault) return;
    expect(second.settings.defaultDurationMinutes).toBe(45);

    // 4. Save again — updates existing row
    const updateResult = await saveAgendaSettingsImpl(
      client,
      validInput({ default_duration_minutes: 90, interval_minutes: 20 }),
    );
    expect(updateResult.ok).toBe(true);

    // 5. Get — should reflect update
    const third = await getAgendaSettingsImpl(client);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.isDefault).toBe(false);
    if (third.isDefault) return;
    expect(third.settings.defaultDurationMinutes).toBe(90);
    expect(third.settings.intervalMinutes).toBe(20);
  });
});
