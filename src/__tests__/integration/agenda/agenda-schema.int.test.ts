import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  agendaSettings,
  locations,
  sessionHistory,
  sessions,
} from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
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

async function seedLocation(userId: string, locationId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(locations).values({
      id: locationId,
      userId,
      name: 'Consultorio A',
      type: 'in_person',
    });
  });
}

afterEach(async () => {
  await cleanTestData();
  await runAsService(async (db) => {
    await db.delete(locations);
    await db.delete(agendaSettings);
  });
});

// =====================================================================
// Table existence
// =====================================================================

describe('agenda tables — existence', () => {
  it.each(['locations', 'agenda_settings', 'sessions', 'session_history'])(
    'table %s exists',
    async (tableName) => {
      const result = await runAsService(async (db) => {
        return db.execute(
          dsql`SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = ${tableName}`,
        );
      });

      expect(result).toHaveLength(1);
    },
  );
});

// =====================================================================
// RLS enabled
// =====================================================================

describe('agenda tables — RLS enabled', () => {
  it.each(['locations', 'agenda_settings', 'sessions', 'session_history'])(
    'RLS is enabled on %s',
    async (tableName) => {
      const result = await runAsService(async (db) => {
        return db.execute(dsql`SELECT relrowsecurity FROM pg_class WHERE relname = ${tableName}`);
      });

      expect(result[0]!.relrowsecurity).toBe(true);
    },
  );
});

// =====================================================================
// RLS policies
// =====================================================================

describe('agenda tables — RLS policies', () => {
  // Tables with full CRUD policies (SELECT, INSERT, UPDATE, DELETE)
  it.each(['locations', 'agenda_settings', 'session_history'])(
    '%s has all four owner-scoped policies',
    async (tableName) => {
      const result = await runAsService(async (db) => {
        return db.execute(
          dsql`SELECT polname, polcmd FROM pg_policy
               WHERE polrelid = ${dsql.raw(`'${tableName}'::regclass`)}
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
    },
  );

  // Sessions: RN-03.05 prohibits hard deletion — only SELECT, INSERT, UPDATE
  it('sessions has three owner-scoped policies (no DELETE — RN-03.05)', async () => {
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
// CHECK constraints
// =====================================================================

describe('locations — CHECK constraints', () => {
  it('rejects invalid type value', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(locations).values({
          id: randomUUID(),
          userId,
          name: 'Bad Location',
          type: 'invalid_type',
        });
      }),
    ).rejects.toThrow();
  });

  it.each(['in_person', 'online', 'other'])('accepts valid type "%s"', async (validType) => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(locations).values({
        id: randomUUID(),
        userId,
        name: `Location ${validType}`,
        type: validType,
      });
    });
  });
});

describe('sessions — CHECK constraints', () => {
  it('rejects invalid status value', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(sessions).values({
          id: randomUUID(),
          userId,
          startAt: new Date(),
          endAt: new Date(Date.now() + 3_000_000),
          durationMinutes: 50,
          status: 'invalid_status',
        });
      }),
    ).rejects.toThrow();
  });

  it('rejects invalid modality value', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(sessions).values({
          id: randomUUID(),
          userId,
          startAt: new Date(),
          endAt: new Date(Date.now() + 3_000_000),
          durationMinutes: 50,
          modality: 'hybrid',
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts null modality (blocking slot)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: randomUUID(),
        userId,
        isBlocking: true,
        blockingTitle: 'Lunch break',
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_600_000),
        durationMinutes: 60,
        modality: null,
        status: 'scheduled',
      });
    });
  });

  it.each(['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'])(
    'accepts valid status "%s"',
    async (validStatus) => {
      const userId = randomUUID();
      await seedAuthUser(userId);

      await runAsService(async (db) => {
        await db.insert(sessions).values({
          id: randomUUID(),
          userId,
          startAt: new Date(),
          endAt: new Date(Date.now() + 3_000_000),
          durationMinutes: 50,
          status: validStatus,
        });
      });
    },
  );
});

describe('session_history — CHECK constraints', () => {
  it('rejects invalid action value', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);

    // Seed a session for the FK
    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(sessionHistory).values({
          id: randomUUID(),
          sessionId,
          userId,
          action: 'invalid_action',
        });
      }),
    ).rejects.toThrow();
  });

  it.each(['created', 'updated', 'rescheduled', 'status_changed', 'deleted'])(
    'accepts valid action "%s"',
    async (validAction) => {
      const userId = randomUUID();
      const sessionId = randomUUID();
      await seedAuthUser(userId);

      await runAsService(async (db) => {
        await db.insert(sessions).values({
          id: sessionId,
          userId,
          startAt: new Date(),
          endAt: new Date(Date.now() + 3_000_000),
          durationMinutes: 50,
        });
      });

      await runAsService(async (db) => {
        await db.insert(sessionHistory).values({
          id: randomUUID(),
          sessionId,
          userId,
          action: validAction,
        });
      });
    },
  );
});

// =====================================================================
// Indexes
// =====================================================================

describe('agenda tables — indexes', () => {
  it.each([
    ['sessions', 'sessions_user_id_start_at_idx'],
    ['sessions', 'sessions_patient_id_start_at_idx'],
    ['sessions', 'sessions_status_start_at_idx'],
    ['session_history', 'session_history_session_id_created_at_idx'],
  ])('table %s has index %s', async (tableName, indexName) => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = ${tableName} AND indexname = ${indexName}`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// FK constraints
// =====================================================================

describe('sessions — FK constraints', () => {
  it('rejects insert with non-existent location_id', async () => {
    const userId = randomUUID();
    const fakeLocationId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(sessions).values({
          id: randomUUID(),
          userId,
          startAt: new Date(),
          endAt: new Date(Date.now() + 3_000_000),
          durationMinutes: 50,
          locationId: fakeLocationId,
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts insert with valid location_id', async () => {
    const userId = randomUUID();
    const locationId = randomUUID();
    await seedAuthUser(userId);
    await seedLocation(userId, locationId);

    const sessionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
        locationId,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.locationId).toBe(locationId);
  });

  it('rejects insert with non-existent patient_id', async () => {
    const userId = randomUUID();
    const fakePatientId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(sessions).values({
          id: randomUUID(),
          userId,
          patientId: fakePatientId,
          startAt: new Date(),
          endAt: new Date(Date.now() + 3_000_000),
          durationMinutes: 50,
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts insert with valid patient_id', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const sessionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        patientId,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(sessions).where(eq(sessions.id, sessionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.patientId).toBe(patientId);
  });
});

describe('session_history — FK cascade', () => {
  it('deleting a session cascades to its history', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);

    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
      });

      await db.insert(sessionHistory).values({
        id: randomUUID(),
        sessionId,
        userId,
        action: 'created',
        changes: { startAt: new Date().toISOString() },
      });
    });

    // Verify history exists before deletion
    const before = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    expect(before).toHaveLength(1);

    // Delete the parent session
    await runAsService(async (db) => {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    });

    // History should be gone
    const after = await runAsService(async (db) => {
      return db.select().from(sessionHistory).where(eq(sessionHistory.sessionId, sessionId));
    });
    expect(after).toHaveLength(0);
  });
});

// =====================================================================
// RLS behavior — locations
// =====================================================================

describe('locations — RLS behavior', () => {
  it('owner can read their own locations', async () => {
    const userA = randomUUID();
    const locationId = randomUUID();
    await seedAuthUser(userA);
    await seedLocation(userA, locationId);

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(locations);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(locationId);
  });

  it("non-owner cannot read another user's locations", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedLocation(userA, randomUUID());

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(locations);
    });

    expect(rows).toHaveLength(0);
  });

  it('owner cannot insert locations with another user_id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await expect(
      runAsUser(userA, async (db) => {
        await db.insert(locations).values({
          id: randomUUID(),
          userId: userB,
          name: 'Hijack attempt',
          type: 'online',
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// RLS behavior — sessions
// =====================================================================

describe('sessions — RLS behavior', () => {
  it('owner can read their own sessions', async () => {
    const userA = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);

    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: sessionId,
        userId: userA,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(sessions);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(sessionId);
  });

  it("non-owner cannot read another user's sessions", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(sessions).values({
        id: randomUUID(),
        userId: userA,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3_000_000),
        durationMinutes: 50,
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(sessions);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// RLS behavior — agenda_settings
// =====================================================================

describe('agenda_settings — RLS behavior', () => {
  it('owner can read their own settings', async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);

    await runAsService(async (db) => {
      await db.insert(agendaSettings).values({ userId: userA });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(agendaSettings);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userA);
    expect(rows[0]!.defaultDurationMinutes).toBe(50);
    expect(rows[0]!.intervalMinutes).toBe(10);
  });

  it("non-owner cannot read another user's settings", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(agendaSettings).values({ userId: userA });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(agendaSettings);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// Policy coverage in migrations
// =====================================================================

describe('agenda — policy coverage in migrations', () => {
  it.each(['locations', 'agenda_settings', 'sessions', 'session_history'])(
    '%s has CREATE POLICY statements in migrations',
    async (tableName) => {
      const { readFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const fg = await import('fast-glob');

      const ROOT = path.resolve(__dirname, '../../../..');
      const files = await fg.default('src/shared/db/migrations/**/*.sql', {
        cwd: ROOT,
        absolute: true,
      });

      let hasPolicy = false;
      const pattern = new RegExp(`CREATE\\s+POLICY\\b[^;]+\\bON\\s+["\`]?${tableName}["\`]?`, 'gi');

      for (const file of files) {
        const source = await readFile(file, 'utf8');
        if (pattern.test(source)) {
          hasPolicy = true;
          break;
        }
      }

      expect(hasPolicy).toBe(true);
    },
  );
});
