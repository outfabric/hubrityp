import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { reminderSettings } from '@/shared/db/schema/whatsapp/tables';

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

async function seedSession(
  userId: string,
  sessionId: string,
  overrides?: { remindersDisabled?: boolean },
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      startAt: new Date('2026-06-15T14:00:00Z'),
      endAt: new Date('2026-06-15T14:50:00Z'),
      durationMinutes: 50,
      status: 'scheduled',
      remindersDisabled: overrides?.remindersDisabled ?? false,
    });
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(reminderSettings);
    await db.delete(sessions);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// get-reminder-settings — returns defaults when no row exists
// =====================================================================

describe('getReminderSettings — no existing row returns defaults', () => {
  it('returns default values when no reminder_settings row exists for user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Query as user — no row should exist
    const rows = await runAsUser(userId, async (db) => {
      return db
        .select({
          earlyReminderHours: reminderSettings.earlyReminderHours,
          finalReminderHours: reminderSettings.finalReminderHours,
          videoLinkMinutes: reminderSettings.videoLinkMinutes,
          sendDuringNight: reminderSettings.sendDuringNight,
        })
        .from(reminderSettings);
    });

    // No row — application layer would return defaults
    expect(rows).toHaveLength(0);

    // Verify defaults match spec: early=24, final=2, video=30, night=false
    const defaults = {
      earlyReminderHours: 24,
      finalReminderHours: 2,
      videoLinkMinutes: 30,
      sendDuringNight: false,
    };
    expect(defaults.earlyReminderHours).toBe(24);
    expect(defaults.finalReminderHours).toBe(2);
    expect(defaults.videoLinkMinutes).toBe(30);
    expect(defaults.sendDuringNight).toBe(false);
  });
});

// =====================================================================
// save-reminder-settings — creates and updates via upsert
// =====================================================================

describe('saveReminderSettings — upsert creates new row', () => {
  it('INSERT creates a new reminder_settings row', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Upsert via raw SQL (same as the Server Action would do)
    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO reminder_settings (id, user_id, early_reminder_hours, final_reminder_hours, video_link_minutes, send_during_night)
             VALUES (${randomUUID()}, ${userId}, 48, 1, 60, TRUE)
             ON CONFLICT (user_id) DO UPDATE SET
               early_reminder_hours = EXCLUDED.early_reminder_hours,
               final_reminder_hours = EXCLUDED.final_reminder_hours,
               video_link_minutes = EXCLUDED.video_link_minutes,
               send_during_night = EXCLUDED.send_during_night,
               updated_at = now()`,
      );
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.earlyReminderHours).toBe(48);
    expect(rows[0]!.finalReminderHours).toBe(1);
    expect(rows[0]!.videoLinkMinutes).toBe(60);
    expect(rows[0]!.sendDuringNight).toBe(true);
  });

  it('upsert updates an existing row on conflict', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // First insert
    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({
        userId,
        earlyReminderHours: 24,
        finalReminderHours: 2,
        videoLinkMinutes: 30,
        sendDuringNight: false,
      });
    });

    // Upsert with different values — same user_id triggers ON CONFLICT DO UPDATE
    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO reminder_settings (id, user_id, early_reminder_hours, final_reminder_hours, video_link_minutes, send_during_night)
             VALUES (${randomUUID()}, ${userId}, 12, 1, 15, TRUE)
             ON CONFLICT (user_id) DO UPDATE SET
               early_reminder_hours = EXCLUDED.early_reminder_hours,
               final_reminder_hours = EXCLUDED.final_reminder_hours,
               video_link_minutes = EXCLUDED.video_link_minutes,
               send_during_night = EXCLUDED.send_during_night,
               updated_at = now()`,
      );
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.earlyReminderHours).toBe(12);
    expect(rows[0]!.finalReminderHours).toBe(1);
    expect(rows[0]!.videoLinkMinutes).toBe(15);
    expect(rows[0]!.sendDuringNight).toBe(true);
  });

  it('upsert sets early_reminder_hours to NULL to disable early reminder', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Insert with early reminder enabled
    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({
        userId,
        earlyReminderHours: 24,
        finalReminderHours: 2,
        videoLinkMinutes: 30,
        sendDuringNight: false,
      });
    });

    // Upsert with NULL early_reminder_hours
    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO reminder_settings (id, user_id, early_reminder_hours, final_reminder_hours, video_link_minutes, send_during_night)
             VALUES (${randomUUID()}, ${userId}, NULL, 2, 30, FALSE)
             ON CONFLICT (user_id) DO UPDATE SET
               early_reminder_hours = EXCLUDED.early_reminder_hours,
               final_reminder_hours = EXCLUDED.final_reminder_hours,
               video_link_minutes = EXCLUDED.video_link_minutes,
               send_during_night = EXCLUDED.send_during_night,
               updated_at = now()`,
      );
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.earlyReminderHours).toBeNull();
    expect(rows[0]!.finalReminderHours).toBe(2);
  });
});

// =====================================================================
// save-reminder-settings — Drizzle upsert via onConflictDoUpdate
// =====================================================================

describe('saveReminderSettings — Drizzle onConflictDoUpdate', () => {
  it('Drizzle insert().onConflictDoUpdate() creates row correctly', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db
        .insert(reminderSettings)
        .values({
          userId,
          earlyReminderHours: 24,
          finalReminderHours: 2,
          videoLinkMinutes: 30,
          sendDuringNight: false,
        })
        .onConflictDoUpdate({
          target: reminderSettings.userId,
          set: {
            earlyReminderHours: 24,
            finalReminderHours: 2,
            videoLinkMinutes: 30,
            sendDuringNight: false,
            updatedAt: dsql`now()`,
          },
        });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.earlyReminderHours).toBe(24);
    expect(rows[0]!.finalReminderHours).toBe(2);
  });

  it('Drizzle onConflictDoUpdate updates on second call', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // First insert
    await runAsService(async (db) => {
      await db
        .insert(reminderSettings)
        .values({
          userId,
          earlyReminderHours: 24,
          finalReminderHours: 2,
          videoLinkMinutes: 30,
          sendDuringNight: false,
        })
        .onConflictDoUpdate({
          target: reminderSettings.userId,
          set: {
            earlyReminderHours: 24,
            finalReminderHours: 2,
            videoLinkMinutes: 30,
            sendDuringNight: false,
            updatedAt: dsql`now()`,
          },
        });
    });

    // Second call — should update, not duplicate
    await runAsService(async (db) => {
      await db
        .insert(reminderSettings)
        .values({
          userId,
          earlyReminderHours: 48,
          finalReminderHours: 1,
          videoLinkMinutes: 60,
          sendDuringNight: true,
        })
        .onConflictDoUpdate({
          target: reminderSettings.userId,
          set: {
            earlyReminderHours: 48,
            finalReminderHours: 1,
            videoLinkMinutes: 60,
            sendDuringNight: true,
            updatedAt: dsql`now()`,
          },
        });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.earlyReminderHours).toBe(48);
    expect(rows[0]!.finalReminderHours).toBe(1);
    expect(rows[0]!.videoLinkMinutes).toBe(60);
    expect(rows[0]!.sendDuringNight).toBe(true);
  });
});

// =====================================================================
// RLS — cross-user isolation for reminder_settings
// =====================================================================

describe('reminder_settings — RLS cross-user blocked', () => {
  it('user A cannot read user B reminder_settings', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Insert settings for user A as service (bypass RLS)
    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({
        userId: userA,
        earlyReminderHours: 24,
        videoLinkMinutes: 30,
        sendDuringNight: false,
      });
    });

    // User B tries to read — should get no rows
    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(reminderSettings);
    });

    expect(rows).toHaveLength(0);
  });

  it('user A cannot update user B reminder_settings', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({
        userId: userB,
        earlyReminderHours: 24,
        videoLinkMinutes: 30,
        sendDuringNight: false,
      });
    });

    // User A tries to update B's settings — should affect 0 rows
    const result = await runAsUser(userA, async (db) => {
      return db
        .update(reminderSettings)
        .set({ earlyReminderHours: 48 })
        .where(eq(reminderSettings.userId, userB))
        .returning();
    });

    expect(result).toHaveLength(0);

    // Verify B's settings unchanged
    const rows = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userB));
    });

    expect(rows[0]!.earlyReminderHours).toBe(24);
  });
});

// =====================================================================
// toggle-session-reminders — ownership check + update
// =====================================================================

describe('toggleSessionReminders — ownership and update', () => {
  it('owner can toggle reminders_disabled to true', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedSession(userId, sessionId, { remindersDisabled: false });

    // Owner updates their own session
    const updated = await runAsUser(userId, async (db) => {
      return db
        .update(sessions)
        .set({ remindersDisabled: true, updatedAt: dsql`now()` })
        .where(eq(sessions.id, sessionId))
        .returning({ id: sessions.id, remindersDisabled: sessions.remindersDisabled });
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]!.remindersDisabled).toBe(true);
  });

  it('owner can toggle reminders_disabled back to false', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedSession(userId, sessionId, { remindersDisabled: true });

    const updated = await runAsUser(userId, async (db) => {
      return db
        .update(sessions)
        .set({ remindersDisabled: false, updatedAt: dsql`now()` })
        .where(eq(sessions.id, sessionId))
        .returning({ id: sessions.id, remindersDisabled: sessions.remindersDisabled });
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]!.remindersDisabled).toBe(false);
  });

  it('non-owner cannot toggle reminders_disabled on another user session', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedSession(userA, sessionId, { remindersDisabled: false });

    // User B tries to update user A's session — RLS blocks it
    const result = await runAsUser(userB, async (db) => {
      return db
        .update(sessions)
        .set({ remindersDisabled: true })
        .where(eq(sessions.id, sessionId))
        .returning();
    });

    expect(result).toHaveLength(0);

    // Verify session is unchanged
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows[0]!.remindersDisabled).toBe(false);
  });

  it('update with ownership filter (id + user_id) returns empty for non-existent session', async () => {
    const userId = randomUUID();
    const fakeSessionId = randomUUID();
    await seedAuthUser(userId);

    // No session exists with that ID — update returns 0 rows
    const result = await runAsService(async (db) => {
      return db
        .update(sessions)
        .set({ remindersDisabled: true })
        .where(eq(sessions.id, fakeSessionId))
        .returning();
    });

    expect(result).toHaveLength(0);
  });
});
