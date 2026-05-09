import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessionRecurrences, sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

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
      fullName: 'Test Patient',
    });
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(sessions);
    await db.delete(sessionRecurrences);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// Table existence
// =====================================================================

describe('session_recurrences — table existence', () => {
  it('session_recurrences table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'session_recurrences'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// RLS enabled
// =====================================================================

describe('session_recurrences — RLS enabled', () => {
  it('RLS is enabled on session_recurrences', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'session_recurrences'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

// =====================================================================
// RLS policies (4 canonical policies)
// =====================================================================

describe('session_recurrences — RLS policies', () => {
  it('has all four owner-scoped policies', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = ${dsql.raw("'session_recurrences'::regclass")}
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    expect(policies).toHaveLength(4);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeDefined(); // DELETE
  });
});

// =====================================================================
// sessions.recurrence_id FK exists
// =====================================================================

describe('sessions — recurrence_id FK', () => {
  it('sessions.recurrence_id references session_recurrences(id)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT constraint_name FROM information_schema.table_constraints
             WHERE table_name = 'sessions'
               AND constraint_type = 'FOREIGN KEY'
               AND constraint_name = 'sessions_recurrence_id_session_recurrences_id_fk'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('accepts insert with valid recurrence_id', async () => {
    const userId = randomUUID();
    const recurrenceId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(sessionRecurrences).values({
        id: recurrenceId,
        userId,
        frequency: 'weekly',
        startDate: '2025-01-01',
      });

      await db.insert(sessions).values({
        id: randomUUID(),
        userId,
        recurrenceId,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
      });
    });
  });

  it('rejects insert with non-existent recurrence_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(sessions).values({
          id: randomUUID(),
          userId,
          recurrenceId: randomUUID(), // does not exist
          startAt: new Date(),
          endAt: new Date(Date.now() + 3_000_000),
          durationMinutes: 50,
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// sessions.patient_ids column exists
// =====================================================================

describe('sessions — patient_ids column', () => {
  it('patient_ids column exists and accepts a UUID array', async () => {
    const userId = randomUUID();
    const patientId1 = randomUUID();
    const patientId2 = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId1);
    await seedPatient(userId, patientId2);

    const sessionId = randomUUID();
    await runAsService(async (db) => {
      // Use raw SQL to set patient_ids because Drizzle type narrowing
      // makes it awkward to pass UUID arrays directly
      await db.execute(
        dsql`INSERT INTO sessions (id, user_id, start_at, end_at, duration_minutes, patient_ids)
             VALUES (${sessionId}, ${userId}, now(), now() + interval '50 minutes', 50,
                     ARRAY[${patientId1}, ${patientId2}]::uuid[])`,
      );
    });

    const rows = await runAsService(async (db) => {
      return db.execute(dsql`SELECT patient_ids FROM sessions WHERE id = ${sessionId}`);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.patient_ids).toEqual([patientId1, patientId2]);
  });
});

// =====================================================================
// sessions.is_late_record column exists
// =====================================================================

describe('sessions — is_late_record column', () => {
  it('is_late_record column exists and defaults to false', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const sessionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.execute(dsql`SELECT is_late_record FROM sessions WHERE id = ${sessionId}`);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_late_record).toBe(false);
  });

  it('accepts is_late_record = true', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const sessionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
        isLateRecord: true,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.execute(dsql`SELECT is_late_record FROM sessions WHERE id = ${sessionId}`);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_late_record).toBe(true);
  });
});

// =====================================================================
// CHECK constraint — patient_ids max 2 entries
// =====================================================================

describe('sessions — patient_ids CHECK constraint', () => {
  it('rejects patient_ids with more than 2 entries', async () => {
    const userId = randomUUID();
    const p1 = randomUUID();
    const p2 = randomUUID();
    const p3 = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO sessions (id, user_id, start_at, end_at, duration_minutes, patient_ids)
               VALUES (${randomUUID()}, ${userId}, now(), now() + interval '50 minutes', 50,
                       ARRAY[${p1}, ${p2}, ${p3}]::uuid[])`,
        );
      }),
    ).rejects.toThrow();
  });

  it('accepts patient_ids with exactly 2 entries', async () => {
    const userId = randomUUID();
    const p1 = randomUUID();
    const p2 = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO sessions (id, user_id, start_at, end_at, duration_minutes, patient_ids)
             VALUES (${randomUUID()}, ${userId}, now(), now() + interval '50 minutes', 50,
                     ARRAY[${p1}, ${p2}]::uuid[])`,
      );
    });
  });

  it('accepts patient_ids with 1 entry', async () => {
    const userId = randomUUID();
    const p1 = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.execute(
        dsql`INSERT INTO sessions (id, user_id, start_at, end_at, duration_minutes, patient_ids)
             VALUES (${randomUUID()}, ${userId}, now(), now() + interval '50 minutes', 50,
                     ARRAY[${p1}]::uuid[])`,
      );
    });
  });

  it('accepts null patient_ids', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: randomUUID(),
        userId,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
        patientIds: null,
      });
    });
  });
});

// =====================================================================
// CHECK constraint — session_recurrences.frequency
// =====================================================================

describe('session_recurrences — frequency CHECK constraint', () => {
  it.each(['weekly', 'biweekly', 'monthly', 'custom'])(
    'accepts valid frequency "%s"',
    async (validFreq) => {
      const userId = randomUUID();
      await seedAuthUser(userId);

      await runAsService(async (db) => {
        await db.insert(sessionRecurrences).values({
          id: randomUUID(),
          userId,
          frequency: validFreq,
          startDate: '2025-01-01',
        });
      });
    },
  );

  it('rejects invalid frequency value', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(sessionRecurrences).values({
          id: randomUUID(),
          userId,
          frequency: 'daily',
          startDate: '2025-01-01',
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// RLS behavior — session_recurrences
// =====================================================================

describe('session_recurrences — RLS behavior', () => {
  it('owner can read their own recurrences', async () => {
    const userA = randomUUID();
    const recId = randomUUID();
    await seedAuthUser(userA);

    await runAsService(async (db) => {
      await db.insert(sessionRecurrences).values({
        id: recId,
        userId: userA,
        frequency: 'weekly',
        startDate: '2025-01-01',
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(sessionRecurrences);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(recId);
  });

  it("non-owner cannot read another user's recurrences (cross-psychologist blocked)", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(sessionRecurrences).values({
        id: randomUUID(),
        userId: userA,
        frequency: 'weekly',
        startDate: '2025-01-01',
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(sessionRecurrences);
    });

    expect(rows).toHaveLength(0);
  });

  it('owner cannot insert recurrence with another user_id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await expect(
      runAsUser(userA, async (db) => {
        await db.insert(sessionRecurrences).values({
          id: randomUUID(),
          userId: userB,
          frequency: 'weekly',
          startDate: '2025-01-01',
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// Index existence — idx_sessions_recurrence
// =====================================================================

describe('sessions — idx_sessions_recurrence index', () => {
  it('idx_sessions_recurrence index exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'sessions' AND indexname = 'idx_sessions_recurrence'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// Policy coverage in migration file
// =====================================================================

describe('session_recurrences — policy coverage in migrations', () => {
  it('has CREATE POLICY statements in migrations', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fg = await import('fast-glob');

    const ROOT = path.resolve(__dirname, '../../../..');
    const files = await fg.default('src/shared/db/migrations/**/*.sql', {
      cwd: ROOT,
      absolute: true,
    });

    let hasPolicy = false;
    const pattern = /CREATE\s+POLICY\b[^;]+\bON\s+[""`]?session_recurrences[""`]?/gi;

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (pattern.test(source)) {
        hasPolicy = true;
        break;
      }
    }

    expect(hasPolicy).toBe(true);
  });
});
