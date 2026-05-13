import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { reminderSettings, whatsappMessages } from '@/shared/db/schema/whatsapp/tables';

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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Reminders Test Patient',
    });
  });
}

async function seedSession(userId: string, sessionId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      startAt: new Date('2026-06-01T10:00:00Z'),
      endAt: new Date('2026-06-01T10:50:00Z'),
      durationMinutes: 50,
      status: 'scheduled',
    });
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(whatsappMessages);
    await db.delete(reminderSettings);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// reminder_settings — table existence, RLS, constraints
// =====================================================================

describe('reminder_settings table — schema verification', () => {
  it('table reminder_settings exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'reminder_settings'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('RLS is enabled on reminder_settings', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'reminder_settings'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('FK constraint with auth.users works — rejects invalid user_id', async () => {
    const fakeUserId = randomUUID();

    await expect(
      runAsService(async (db) => {
        await db.insert(reminderSettings).values({
          userId: fakeUserId,
        });
      }),
    ).rejects.toThrow();
  });

  it('UNIQUE(user_id) prevents duplicate settings for the same user', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({ userId });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(reminderSettings).values({ userId });
      }),
    ).rejects.toThrow();
  });

  it('default values are applied correctly', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({ userId });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.earlyReminderHours).toBeNull();
    expect(row.finalReminderHours).toBeNull();
    expect(row.videoLinkMinutes).toBe(30);
    expect(row.sendDuringNight).toBe(false);
  });

  it('accepts non-default values', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({
        userId,
        earlyReminderHours: 24,
        finalReminderHours: 2,
        videoLinkMinutes: 15,
        sendDuringNight: true,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId));
    });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.earlyReminderHours).toBe(24);
    expect(row.finalReminderHours).toBe(2);
    expect(row.videoLinkMinutes).toBe(15);
    expect(row.sendDuringNight).toBe(true);
  });
});

describe('reminder_settings — RLS policies', () => {
  it('owner can read their own settings', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({ userId });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(reminderSettings);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
  });

  it('owner cannot read another user settings', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(reminderSettings).values({ userId: userA });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(reminderSettings);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// whatsapp_messages — table existence, RLS, constraints, indexes
// =====================================================================

describe('whatsapp_messages table — schema verification', () => {
  it('table whatsapp_messages exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'whatsapp_messages'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('RLS is enabled on whatsapp_messages', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'whatsapp_messages'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('CHECK constraint rejects invalid direction', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO whatsapp_messages (id, user_id, direction)
               VALUES (${randomUUID()}, ${userId}, 'broadcast')`,
        );
      }),
    ).rejects.toThrow();
  });

  it('CHECK constraint accepts valid direction values', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    for (const dir of ['outbound', 'inbound']) {
      await runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO whatsapp_messages (id, user_id, direction)
               VALUES (${randomUUID()}, ${userId}, ${dir})`,
        );
      });
    }
  });

  it('CHECK constraint rejects invalid status', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO whatsapp_messages (id, user_id, direction, status)
               VALUES (${randomUUID()}, ${userId}, 'outbound', 'expired')`,
        );
      }),
    ).rejects.toThrow();
  });

  it('CHECK constraint accepts valid status values', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    for (const status of ['queued', 'sent', 'delivered', 'read', 'failed', 'unable_to_send']) {
      await runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO whatsapp_messages (id, user_id, direction, status)
               VALUES (${randomUUID()}, ${userId}, 'outbound', ${status})`,
        );
      });
    }
  });

  it('FK constraint with auth.users works — rejects invalid user_id', async () => {
    const fakeUserId = randomUUID();

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappMessages).values({
          userId: fakeUserId,
          direction: 'outbound',
        });
      }),
    ).rejects.toThrow();
  });

  it('FK constraint with patients works — rejects invalid patient_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappMessages).values({
          userId,
          patientId: randomUUID(), // not in patients table
          direction: 'outbound',
        });
      }),
    ).rejects.toThrow();
  });

  it('FK constraint with sessions works — rejects invalid session_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappMessages).values({
          userId,
          sessionId: randomUUID(), // not in sessions table
          direction: 'outbound',
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts valid patient_id and session_id FK references', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId);

    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId,
        patientId,
        sessionId,
        direction: 'outbound',
        status: 'queued',
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.userId, userId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.patientId).toBe(patientId);
    expect(rows[0]!.sessionId).toBe(sessionId);
  });
});

describe('whatsapp_messages — indexes verification', () => {
  it('indexes exist on whatsapp_messages', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'whatsapp_messages'
             ORDER BY indexname`,
      );
    });

    const indexNames = result.map((r: Record<string, unknown>) => r.indexname as string);

    expect(indexNames).toContain('whatsapp_messages_user_id_created_at_idx');
    expect(indexNames).toContain('whatsapp_messages_session_id_idx');
    expect(indexNames).toContain('whatsapp_messages_patient_id_created_at_idx');
    expect(indexNames).toContain('whatsapp_messages_bsp_message_id_unique_idx');
    expect(indexNames).toContain('whatsapp_messages_idempotency_key_unique_idx');
  });
});

describe('whatsapp_messages — partial UNIQUE on bsp_message_id', () => {
  it('allows multiple NULL bsp_message_id values', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Two rows with NULL bsp_message_id should be fine
    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values([
        { userId, direction: 'outbound' },
        { userId, direction: 'outbound' },
      ]);
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.userId, userId));
    });

    expect(rows).toHaveLength(2);
  });

  it('rejects duplicate non-NULL bsp_message_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId,
        direction: 'outbound',
        bspMessageId: 'SM_duplicate_test',
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappMessages).values({
          userId,
          direction: 'outbound',
          bspMessageId: 'SM_duplicate_test',
        });
      }),
    ).rejects.toThrow();
  });
});

describe('whatsapp_messages — partial UNIQUE on idempotency_key', () => {
  it('allows multiple NULL idempotency_key values', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values([
        { userId, direction: 'outbound' },
        { userId, direction: 'outbound' },
      ]);
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.userId, userId));
    });

    expect(rows).toHaveLength(2);
  });

  it('rejects duplicate idempotency_key for non-failed messages', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId,
        direction: 'outbound',
        idempotencyKey: 'idem_001',
        status: 'queued',
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(whatsappMessages).values({
          userId,
          direction: 'outbound',
          idempotencyKey: 'idem_001',
          status: 'sent',
        });
      }),
    ).rejects.toThrow();
  });

  it('allows same idempotency_key if prior message failed', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // First message with 'failed' status
    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId,
        direction: 'outbound',
        idempotencyKey: 'idem_retry',
        status: 'failed',
      });
    });

    // Retry with same idempotency_key and non-failed status should succeed
    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId,
        direction: 'outbound',
        idempotencyKey: 'idem_retry',
        status: 'queued',
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.userId, userId));
    });

    expect(rows).toHaveLength(2);
  });
});

describe('whatsapp_messages — RLS policies', () => {
  it('owner can read their own messages', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId,
        direction: 'outbound',
        status: 'sent',
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(whatsappMessages);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
  });

  it('owner cannot read another user messages', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(whatsappMessages).values({
        userId: userA,
        direction: 'outbound',
        status: 'sent',
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(whatsappMessages);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// sessions — reminders_disabled column
// =====================================================================

describe('sessions table — reminders_disabled column', () => {
  it('reminders_disabled column exists and defaults to false', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedSession(userId, sessionId);

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.remindersDisabled).toBe(false);
  });

  it('reminders_disabled accepts true value', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T10:50:00Z'),
        durationMinutes: 50,
        status: 'scheduled',
        remindersDisabled: true,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.remindersDisabled).toBe(true);
  });
});
