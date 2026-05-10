import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessionHistory, sessions } from '@/shared/db/schema/agenda/tables';

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

function makeSession(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    userId,
    startAt: new Date(),
    endAt: new Date(Date.now() + 3_000_000),
    durationMinutes: 50,
    ...overrides,
  };
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(sessionHistory);
    await db.delete(sessions);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// New columns exist
// =====================================================================

describe('sessions schema extension — new columns', () => {
  it.each([
    'cancellation_reason',
    'cancelled_by',
    'cancellation_notice',
    'cancelled_at',
    'charge_cancellation',
    'confirmation_token',
    'confirmed_at',
    'rescheduled_to_session_id',
    'rescheduled_from_session_id',
    'deleted_at',
  ])('column %s exists on sessions table', async (columnName) => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'sessions'
               AND column_name = ${columnName}`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// CHECK constraint — status lifecycle values
// =====================================================================

describe('sessions — status CHECK constraint', () => {
  it.each(['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'])(
    'accepts valid status "%s"',
    async (validStatus) => {
      const userId = randomUUID();
      await seedAuthUser(userId);

      await runAsService(async (db) => {
        await db.insert(sessions).values(makeSession(userId, { status: validStatus }));
      });
    },
  );

  it.each(['pending', 'active', 'completed', 'invalid_status', 'SCHEDULED'])(
    'rejects invalid status "%s"',
    async (invalidStatus) => {
      const userId = randomUUID();
      await seedAuthUser(userId);

      await expect(
        runAsService(async (db) => {
          await db.insert(sessions).values(makeSession(userId, { status: invalidStatus }));
        }),
      ).rejects.toThrow();
    },
  );
});

// =====================================================================
// UNIQUE constraint — confirmation_token
// =====================================================================

describe('sessions — confirmation_token UNIQUE constraint', () => {
  it('allows multiple NULL confirmation_token values', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db
        .insert(sessions)
        .values([
          makeSession(userId, { confirmationToken: null }),
          makeSession(userId, { confirmationToken: null }),
        ]);
    });
  });

  it('enforces uniqueness on non-NULL confirmation_token', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const token = 'unique-token-abc123';

    await runAsService(async (db) => {
      await db.insert(sessions).values(makeSession(userId, { confirmationToken: token }));
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(sessions).values(makeSession(userId, { confirmationToken: token }));
      }),
    ).rejects.toThrow();
  });

  it('allows different non-NULL confirmation_token values', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db
        .insert(sessions)
        .values([
          makeSession(userId, { confirmationToken: 'token-a' }),
          makeSession(userId, { confirmationToken: 'token-b' }),
        ]);
    });
  });
});

// =====================================================================
// Self-referencing FKs — reschedule links
// =====================================================================

describe('sessions — reschedule self-referencing FKs', () => {
  it('accepts valid rescheduled_to_session_id referencing another session', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const oldSessionId = randomUUID();
    const newSessionId = randomUUID();

    await runAsService(async (db) => {
      // Create both sessions first
      await db
        .insert(sessions)
        .values([
          makeSession(userId, { id: oldSessionId, status: 'cancelled' }),
          makeSession(userId, { id: newSessionId }),
        ]);

      // Link them
      await db
        .update(sessions)
        .set({ rescheduledToSessionId: newSessionId })
        .where(eq(sessions.id, oldSessionId));

      await db
        .update(sessions)
        .set({ rescheduledFromSessionId: oldSessionId })
        .where(eq(sessions.id, newSessionId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, oldSessionId));
    });

    expect(rows[0]!.rescheduledToSessionId).toBe(newSessionId);
  });

  it('rejects rescheduled_to_session_id referencing non-existent session', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const sessionId = randomUUID();
    const fakeId = randomUUID();

    await runAsService(async (db) => {
      await db.insert(sessions).values(makeSession(userId, { id: sessionId }));
    });

    await expect(
      runAsService(async (db) => {
        await db
          .update(sessions)
          .set({ rescheduledToSessionId: fakeId })
          .where(eq(sessions.id, sessionId));
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// RLS — DELETE is blocked (RN-03.05)
// =====================================================================

describe('sessions — RLS blocks DELETE (RN-03.05)', () => {
  it('owner cannot DELETE their own session via RLS', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    // Seed a session as service role (bypasses RLS)
    const sessionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(sessions).values(makeSession(userId, { id: sessionId }));
    });

    // Attempt to delete as the owner — should silently fail (no matching
    // policy means 0 rows affected, not an error)
    const deletedRows = await runAsUser(userId, async (db) => {
      return db.delete(sessions).where(eq(sessions.id, sessionId)).returning();
    });

    expect(deletedRows).toHaveLength(0);

    // Verify the session still exists
    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows).toHaveLength(1);
  });
});

// =====================================================================
// RLS — UPDATE is allowed for owner
// =====================================================================

describe('sessions — RLS allows UPDATE for owner', () => {
  it('owner can UPDATE their own session status', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const sessionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(sessions).values(makeSession(userId, { id: sessionId }));
    });

    await runAsUser(userId, async (db) => {
      await db.update(sessions).set({ status: 'confirmed' }).where(eq(sessions.id, sessionId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows[0]!.status).toBe('confirmed');
  });

  it('owner can UPDATE cancellation fields on their session', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const sessionId = randomUUID();
    const now = new Date();
    await runAsService(async (db) => {
      await db.insert(sessions).values(makeSession(userId, { id: sessionId }));
    });

    await runAsUser(userId, async (db) => {
      await db
        .update(sessions)
        .set({
          status: 'cancelled',
          cancellationReason: 'Paciente solicitou',
          cancelledBy: 'patient',
          cancellationNotice: '24h+',
          cancelledAt: now,
          chargeCancellation: false,
        })
        .where(eq(sessions.id, sessionId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows[0]!.status).toBe('cancelled');
    expect(rows[0]!.cancellationReason).toBe('Paciente solicitou');
    expect(rows[0]!.cancelledBy).toBe('patient');
    expect(rows[0]!.cancellationNotice).toBe('24h+');
    expect(rows[0]!.chargeCancellation).toBe(false);
  });

  it('owner can set soft-delete via deleted_at', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const sessionId = randomUUID();
    const now = new Date();
    await runAsService(async (db) => {
      await db.insert(sessions).values(makeSession(userId, { id: sessionId, status: 'cancelled' }));
    });

    await runAsUser(userId, async (db) => {
      await db.update(sessions).set({ deletedAt: now }).where(eq(sessions.id, sessionId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows[0]!.deletedAt).toBeTruthy();
  });
});

// =====================================================================
// Existing sessions RLS policies still present (SELECT, INSERT, UPDATE)
// =====================================================================

describe('sessions — RLS policies after extension', () => {
  it('has exactly 3 policies (SELECT, INSERT, UPDATE — no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'sessions'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    expect(policies).toHaveLength(3);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeUndefined(); // NO DELETE
  });
});

// =====================================================================
// Partial unique index exists
// =====================================================================

describe('sessions — confirmation_token unique index', () => {
  it('partial unique index sessions_confirmation_token_unique_idx exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname, indexdef FROM pg_indexes
             WHERE tablename = 'sessions'
               AND indexname = 'sessions_confirmation_token_unique_idx'`,
      );
    });

    expect(result).toHaveLength(1);
    const indexDef = (result[0]!.indexdef as string).toLowerCase();
    expect(indexDef).toContain('unique');
    expect(indexDef).toContain('where');
    expect(indexDef).toContain('confirmation_token');
  });
});
