import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { sessions } from '@/shared/db/schema/agenda/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import {
  videoRecordings,
  videoRooms,
  videoSessionLogs,
} from '@/shared/db/schema/telepsicologia/tables';

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

async function seedSession(userId: string, sessionId: string, patientId: string): Promise<void> {
  const now = new Date();
  const later = new Date(now.getTime() + 3600_000);
  await runAsService(async (db) => {
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      patientId,
      startAt: now,
      endAt: later,
      durationMinutes: 50,
      status: 'scheduled',
    });
  });
}

function makeVideoRoomValues(userId: string, sessionId: string) {
  const now = new Date();
  return {
    id: randomUUID(),
    userId,
    sessionId,
    streamCallId: `call_${randomUUID()}`,
    patientToken: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
    patientJwt: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.patient',
    availableFrom: now,
    expiresAt: new Date(now.getTime() + 7200_000),
    status: 'pending' as const,
  };
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(videoRecordings);
    await db.delete(videoSessionLogs);
    await db.delete(videoRooms);
    await db.delete(sessions);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// =====================================================================
// Table existence
// =====================================================================

describe('telepsicologia tables — existence', () => {
  it.each(['video_rooms', 'video_session_logs', 'video_recordings'])(
    '%s table exists',
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

describe('telepsicologia tables — RLS enabled', () => {
  it.each(['video_rooms', 'video_session_logs', 'video_recordings'])(
    'RLS is enabled on %s',
    async (tableName) => {
      const result = await runAsService(async (db) => {
        return db.execute(
          dsql`SELECT relrowsecurity FROM pg_class WHERE relname = ${tableName}`,
        );
      });
      expect(result[0]!.relrowsecurity).toBe(true);
    },
  );
});

// =====================================================================
// RLS policies — correct count per table
// =====================================================================

describe('telepsicologia tables — RLS policy coverage', () => {
  it('video_rooms has 4 policies (SELECT/INSERT/UPDATE/DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'video_rooms'::regclass
             ORDER BY polname`,
      );
    });
    const policies = result.map((r) => r.polcmd as string);
    expect(policies).toHaveLength(4);
    expect(policies).toContain('r'); // SELECT
    expect(policies).toContain('a'); // INSERT
    expect(policies).toContain('w'); // UPDATE
    expect(policies).toContain('d'); // DELETE
  });

  it('video_session_logs has 2 policies (SELECT/INSERT only — append-only)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'video_session_logs'::regclass
             ORDER BY polname`,
      );
    });
    const policies = result.map((r) => r.polcmd as string);
    expect(policies).toHaveLength(2);
    expect(policies).toContain('r'); // SELECT
    expect(policies).toContain('a'); // INSERT
    // No UPDATE or DELETE
    expect(policies).not.toContain('w');
    expect(policies).not.toContain('d');
  });

  it('video_recordings has 3 policies (SELECT/INSERT/UPDATE — no delete)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'video_recordings'::regclass
             ORDER BY polname`,
      );
    });
    const policies = result.map((r) => r.polcmd as string);
    expect(policies).toHaveLength(3);
    expect(policies).toContain('r'); // SELECT
    expect(policies).toContain('a'); // INSERT
    expect(policies).toContain('w'); // UPDATE
    // No DELETE
    expect(policies).not.toContain('d');
  });
});

// =====================================================================
// CHECK constraints
// =====================================================================

describe('video_rooms — CHECK constraints', () => {
  it('rejects invalid status', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(videoRooms).values({
          ...makeVideoRoomValues(userId, sessionId),
          status: 'invalid_status',
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts valid statuses', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    for (const status of ['pending', 'active', 'ended', 'expired']) {
      const patientId = randomUUID();
      const sessionId = randomUUID();
      await seedPatient(userId, patientId);
      await seedSession(userId, sessionId, patientId);

      await runAsService(async (db) => {
        await db.insert(videoRooms).values({
          ...makeVideoRoomValues(userId, sessionId),
          status,
        });
      });
    }

    const rows = await runAsService(async (db) => {
      return db.select().from(videoRooms).where(eq(videoRooms.userId, userId));
    });
    expect(rows).toHaveLength(4);
  });
});

describe('video_session_logs — CHECK constraints', () => {
  it('rejects invalid event_type', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(videoSessionLogs).values({
          sessionId,
          userId,
          eventType: 'invalid_event',
        });
      }),
    ).rejects.toThrow();
  });

  it('accepts all 16 valid event types', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const validEvents = [
      'therapist_joined',
      'patient_joined',
      'partner_joined',
      'therapist_left',
      'patient_left',
      'partner_left',
      'screen_share_started',
      'screen_share_ended',
      'connection_drop',
      'reconnected',
      'recording_started',
      'recording_ended',
      'room_ended',
      'room_expired',
      'session_summary',
      'session_extended',
    ];

    for (const eventType of validEvents) {
      await runAsService(async (db) => {
        await db.insert(videoSessionLogs).values({
          sessionId,
          userId,
          eventType,
        });
      });
    }

    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(videoSessionLogs)
        .where(eq(videoSessionLogs.sessionId, sessionId));
    });
    expect(rows).toHaveLength(16);
  });
});

describe('video_recordings — CHECK constraints', () => {
  it('rejects invalid status', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(videoRecordings).values({
          sessionId,
          userId,
          status: 'invalid_status',
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// UNIQUE constraint on video_rooms.session_id
// =====================================================================

describe('video_rooms — UNIQUE session_id', () => {
  it('rejects duplicate session_id', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    const baseValues = makeVideoRoomValues(userId, sessionId);
    await runAsService(async (db) => {
      await db.insert(videoRooms).values(baseValues);
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(videoRooms).values({
          ...makeVideoRoomValues(userId, sessionId),
          id: randomUUID(),
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// FK constraints
// =====================================================================

describe('video_rooms — FK constraints', () => {
  it('rejects insert with non-existent session_id', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(videoRooms).values(makeVideoRoomValues(userId, randomUUID()));
      }),
    ).rejects.toThrow();
  });

  it('rejects insert with non-existent user_id', async () => {
    const userId = randomUUID();
    const realUserId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(realUserId);
    await seedPatient(realUserId, patientId);
    await seedSession(realUserId, sessionId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(videoRooms).values({
          ...makeVideoRoomValues(userId, sessionId),
          userId, // non-existent in auth.users
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// Indexes
// =====================================================================

describe('telepsicologia tables — indexes', () => {
  it('video_rooms has unique index on session_id', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'video_rooms' AND indexname = 'video_rooms_session_id_unique_idx'`,
      );
    });
    expect(result).toHaveLength(1);
  });

  it('video_rooms has index on (user_id, status)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'video_rooms' AND indexname = 'video_rooms_user_id_status_idx'`,
      );
    });
    expect(result).toHaveLength(1);
  });

  it('video_rooms has index on (expires_at)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'video_rooms' AND indexname = 'video_rooms_expires_at_idx'`,
      );
    });
    expect(result).toHaveLength(1);
  });

  it('video_session_logs has index on (session_id, created_at)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'video_session_logs' AND indexname = 'video_session_logs_session_id_created_at_idx'`,
      );
    });
    expect(result).toHaveLength(1);
  });

  it('video_recordings has index on (session_id)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'video_recordings' AND indexname = 'video_recordings_session_id_idx'`,
      );
    });
    expect(result).toHaveLength(1);
  });

  it('video_session_logs has index on (user_id) for RLS performance', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'video_session_logs' AND indexname = 'video_session_logs_user_id_idx'`,
      );
    });
    expect(result).toHaveLength(1);
  });

  it('video_recordings has index on (user_id) for RLS performance', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'video_recordings' AND indexname = 'video_recordings_user_id_idx'`,
      );
    });
    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// Recording consent columns on patients
// =====================================================================

describe('patients — recording consent columns', () => {
  it('recording_consent_signed_at is a nullable timestamptz', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_name = 'patients' AND column_name = 'recording_consent_signed_at'`,
      );
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.data_type).toBe('timestamp with time zone');
    expect(result[0]!.is_nullable).toBe('YES');
  });

  it('recording_consent_revoked_at is a nullable timestamptz', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_name = 'patients' AND column_name = 'recording_consent_revoked_at'`,
      );
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.data_type).toBe('timestamp with time zone');
    expect(result[0]!.is_nullable).toBe('YES');
  });

  it('accepts values for recording consent columns', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);

    const now = new Date();
    await runAsService(async (db) => {
      await db.insert(patients).values({
        id: patientId,
        userId,
        fullName: 'Consent Test Patient',
        recordingConsentSignedAt: now,
        recordingConsentRevokedAt: null,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.id, patientId));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordingConsentSignedAt).toBeInstanceOf(Date);
    expect(rows[0]!.recordingConsentRevokedAt).toBeNull();
  });
});

// =====================================================================
// RLS cross-user tests (negative-auth)
// =====================================================================

describe('RLS cross-user isolation', () => {
  it('user B cannot SELECT user A video_rooms', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    await runAsService(async (db) => {
      await db.insert(videoRooms).values(makeVideoRoomValues(userA, sessionId));
    });

    // User A can see their own room
    const rowsA = await runAsUser(userA, async (db) => {
      return db.select().from(videoRooms);
    });
    expect(rowsA).toHaveLength(1);

    // User B sees nothing
    const rowsB = await runAsUser(userB, async (db) => {
      return db.select().from(videoRooms);
    });
    expect(rowsB).toHaveLength(0);
  });

  it('user B cannot SELECT user A video_session_logs', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    await runAsService(async (db) => {
      await db.insert(videoSessionLogs).values({
        sessionId,
        userId: userA,
        eventType: 'therapist_joined',
        participantRole: 'therapist',
      });
    });

    const rowsA = await runAsUser(userA, async (db) => {
      return db.select().from(videoSessionLogs);
    });
    expect(rowsA).toHaveLength(1);

    const rowsB = await runAsUser(userB, async (db) => {
      return db.select().from(videoSessionLogs);
    });
    expect(rowsB).toHaveLength(0);
  });

  it('user B cannot SELECT user A video_recordings', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    await runAsService(async (db) => {
      await db.insert(videoRecordings).values({
        sessionId,
        userId: userA,
        status: 'idle',
      });
    });

    const rowsA = await runAsUser(userA, async (db) => {
      return db.select().from(videoRecordings);
    });
    expect(rowsA).toHaveLength(1);

    const rowsB = await runAsUser(userB, async (db) => {
      return db.select().from(videoRecordings);
    });
    expect(rowsB).toHaveLength(0);
  });

  it('user A cannot INSERT video_rooms with user B user_id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userB, patientId);
    await seedSession(userB, sessionId, patientId);

    await expect(
      runAsUser(userA, async (db) => {
        await db.insert(videoRooms).values({
          ...makeVideoRoomValues(userB, sessionId),
          userId: userB,
        });
      }),
    ).rejects.toThrow();
  });

  it('video_session_logs: user cannot UPDATE (no update policy)', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const logId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    await runAsService(async (db) => {
      await db.insert(videoSessionLogs).values({
        id: logId,
        sessionId,
        userId: userA,
        eventType: 'therapist_joined',
      });
    });

    // UPDATE should silently affect 0 rows (RLS blocks it)
    await runAsUser(userA, async (db) => {
      await db
        .update(videoSessionLogs)
        .set({ eventType: 'patient_joined' })
        .where(eq(videoSessionLogs.id, logId));
    });

    // Verify the row is unchanged
    const rows = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.id, logId));
    });
    expect(rows[0]!.eventType).toBe('therapist_joined');
  });

  it('video_session_logs: user cannot DELETE (no delete policy)', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const logId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    await runAsService(async (db) => {
      await db.insert(videoSessionLogs).values({
        id: logId,
        sessionId,
        userId: userA,
        eventType: 'room_ended',
      });
    });

    // DELETE should silently affect 0 rows (RLS blocks it)
    await runAsUser(userA, async (db) => {
      await db.delete(videoSessionLogs).where(eq(videoSessionLogs.id, logId));
    });

    // Row still exists
    const rows = await runAsService(async (db) => {
      return db.select().from(videoSessionLogs).where(eq(videoSessionLogs.id, logId));
    });
    expect(rows).toHaveLength(1);
  });

  it('video_recordings: user cannot DELETE (no delete policy)', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const recId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);
    await seedSession(userA, sessionId, patientId);

    await runAsService(async (db) => {
      await db.insert(videoRecordings).values({
        id: recId,
        sessionId,
        userId: userA,
        status: 'idle',
      });
    });

    // DELETE should silently affect 0 rows (RLS blocks it)
    await runAsUser(userA, async (db) => {
      await db.delete(videoRecordings).where(eq(videoRecordings.id, recId));
    });

    // Row still exists
    const rows = await runAsService(async (db) => {
      return db.select().from(videoRecordings).where(eq(videoRecordings.id, recId));
    });
    expect(rows).toHaveLength(1);
  });
});

// =====================================================================
// RLS policy coverage — migration verification
// =====================================================================

describe('RLS policy coverage — telepsicologia in migrations', () => {
  it.each(['video_rooms', 'video_session_logs', 'video_recordings'])(
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
      const pattern = new RegExp(
        `CREATE\\s+POLICY\\b[^;]+\\bON\\s+["\`]?${tableName}["\`]?`,
        'gi',
      );

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
