import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { patients } from '@/shared/db/schema/patients/tables';

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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: `Patient ${patientId.slice(0, 8)}`,
    });
  });
}

// Seed a session row via raw SQL to avoid importing agenda schema tables
// (which are not needed beyond providing a valid FK target).
async function seedSession(userId: string, sessionId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO sessions (id, user_id, patient_id, start_at, end_at, duration_minutes)
           VALUES (${sessionId}, ${userId}, ${patientId}, now(), now() + interval '50 minutes', 50)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

// Seed an evolution row via raw SQL for FK target.
async function seedEvolution(
  userId: string,
  patientId: string,
  evolutionId: string,
): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO evolutions (id, user_id, patient_id, template_type, content)
           VALUES (${evolutionId}, ${userId}, ${patientId}, 'livre', '{}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

afterEach(async () => {
  // Clean in reverse FK order. Scope deletes to rows owned by our test
  // users to avoid interfering with other test files sharing the container.
  await runAsService(async (db) => {
    await db.execute(
      dsql`DELETE FROM ai_transcriptions
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM ai_transcription_settings
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM evolutions
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM sessions
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM patients
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// (a) pg_policies shows exactly 8 policies referencing auth.uid()
// ---------------------------------------------------------------------------

describe('ai-transcription schema — RLS policies', () => {
  it('has exactly 4 owner-scoped policies on ai_transcription_settings', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'ai_transcription_settings'::regclass
             ORDER BY polname`,
      );
    });

    expect(result).toHaveLength(4);
    const cmds = result.map((r) => r.polcmd as string);
    expect(cmds).toContain('r'); // SELECT
    expect(cmds).toContain('a'); // INSERT
    expect(cmds).toContain('w'); // UPDATE
    expect(cmds).toContain('d'); // DELETE
  });

  it('has exactly 4 owner-scoped policies on ai_transcriptions', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'ai_transcriptions'::regclass
             ORDER BY polname`,
      );
    });

    expect(result).toHaveLength(4);
    const cmds = result.map((r) => r.polcmd as string);
    expect(cmds).toContain('r'); // SELECT
    expect(cmds).toContain('a'); // INSERT
    expect(cmds).toContain('w'); // UPDATE
    expect(cmds).toContain('d'); // DELETE
  });

  it('all 8 policies reference auth.uid()', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polrelid::regclass::text AS tablename,
                    pg_get_expr(polqual, polrelid) AS using_expr,
                    pg_get_expr(polwithcheck, polrelid) AS with_check_expr
             FROM pg_policy
             WHERE polrelid IN ('ai_transcription_settings'::regclass, 'ai_transcriptions'::regclass)`,
      );
    });

    expect(result).toHaveLength(8);
    for (const row of result) {
      const usingExpr = (row.using_expr as string) || '';
      const withCheckExpr = (row.with_check_expr as string) || '';
      const combined = `${usingExpr} ${withCheckExpr}`;
      const polname = row.polname as string;
      const tablename = row.tablename as string;
      expect(combined, `policy "${polname}" on "${tablename}" must reference auth.uid()`).toMatch(
        /auth\.uid\(\)/,
      );
    }
  });

  it('RLS is enabled on ai_transcription_settings', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'ai_transcription_settings'`,
      );
    });
    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('RLS is enabled on ai_transcriptions', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'ai_transcriptions'`,
      );
    });
    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) pg_indexes shows the 3 expected indexes
// ---------------------------------------------------------------------------

describe('ai-transcription schema — indexes', () => {
  it('has idx_ai_transcriptions_user_status', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'ai_transcriptions'
               AND indexname = 'idx_ai_transcriptions_user_status'`,
      );
    });
    expect(result).toHaveLength(1);
  });

  it('has idx_ai_transcriptions_user_created', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'ai_transcriptions'
               AND indexname = 'idx_ai_transcriptions_user_created'`,
      );
    });
    expect(result).toHaveLength(1);
  });

  it('has partial idx_ai_transcriptions_audio_to_discard', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname, indexdef FROM pg_indexes
             WHERE tablename = 'ai_transcriptions'
               AND indexname = 'idx_ai_transcriptions_audio_to_discard'`,
      );
    });
    expect(result).toHaveLength(1);
    // Verify the partial index has the expected WHERE clause.
    const indexDef = result[0]!.indexdef as string;
    expect(indexDef).toMatch(/WHERE/i);
    expect(indexDef).toMatch(/audio_object_key IS NOT NULL/i);
    expect(indexDef).toMatch(/audio_discarded_at IS NULL/i);
  });
});

// ---------------------------------------------------------------------------
// (c) storage bucket existence
// The Testcontainers Postgres does not have the `storage` schema, so the
// bucket creation is guarded by an IF EXISTS check. We verify the migration
// ran without error; the actual bucket existence is tested in the real
// Supabase environment (task 2.9).
// ---------------------------------------------------------------------------

describe('ai-transcription schema — storage bucket', () => {
  it('migration runs cleanly even without storage schema (Testcontainers guard)', async () => {
    // The fact that we got here means the migration applied without error.
    // Verify the storage schema does NOT exist in Testcontainers.
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'storage'`,
      );
    });
    // In Testcontainers, storage schema is not present — the DO block skips.
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (d) NOT NULL violation on patient_id
// ---------------------------------------------------------------------------

describe('ai-transcription schema — constraints', () => {
  it('inserting a row with patient_id = NULL raises NOT NULL violation', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.execute(
          dsql`INSERT INTO ai_transcriptions (id, user_id, patient_id, source)
               VALUES (${randomUUID()}, ${userId}, NULL, 'manual_upload')`,
        );
      }),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------------
  // (e) status CHECK rejects invalid values
  // ---------------------------------------------------------------------------

  it('status CHECK rejects "archived" as an invalid status', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Insert a valid row first.
    const transcriptionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(aiTranscriptions).values({
        id: transcriptionId,
        userId,
        patientId,
        source: 'manual_upload',
        status: 'pending',
      });
    });

    // Attempt to update to an invalid status — CHECK constraint rejects.
    await expect(
      runAsService(async (db) => {
        await db
          .update(aiTranscriptions)
          .set({ status: 'archived' })
          .where(eq(aiTranscriptions.id, transcriptionId));
      }),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------------
  // (f) deleting an evolutions row sets linked ai_transcriptions.evolution_id
  //     to NULL (ON DELETE SET NULL)
  // ---------------------------------------------------------------------------

  it('deleting an evolutions row sets linked ai_transcriptions.evolution_id to NULL', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const evolutionId = randomUUID();
    const transcriptionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedEvolution(userId, patientId, evolutionId);

    // Insert a transcription linked to the evolution.
    await runAsService(async (db) => {
      await db.insert(aiTranscriptions).values({
        id: transcriptionId,
        userId,
        patientId,
        evolutionId,
        source: 'manual_upload',
        status: 'pending',
      });
    });

    // Delete the evolution row.
    await runAsService(async (db) => {
      await db.execute(dsql`DELETE FROM evolutions WHERE id = ${evolutionId}`);
    });

    // Verify evolution_id is now NULL.
    const rows = await runAsService(async (db) => {
      return db.select().from(aiTranscriptions).where(eq(aiTranscriptions.id, transcriptionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.evolutionId).toBeNull();
  });

  it('deleting a sessions row sets linked ai_transcriptions.session_id to NULL', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const sessionId = randomUUID();
    const transcriptionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSession(userId, sessionId, patientId);

    await runAsService(async (db) => {
      await db.insert(aiTranscriptions).values({
        id: transcriptionId,
        userId,
        patientId,
        sessionId,
        source: 'video_session',
        status: 'pending',
      });
    });

    // Delete the session row (soft-delete is app-level; FK is hard).
    await runAsService(async (db) => {
      await db.execute(dsql`DELETE FROM sessions WHERE id = ${sessionId}`);
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(aiTranscriptions).where(eq(aiTranscriptions.id, transcriptionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBeNull();
  });
});
