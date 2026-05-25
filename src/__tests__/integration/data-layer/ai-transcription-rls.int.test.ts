import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  aiTranscriptionSettings,
  aiTranscriptions,
} from '@/shared/db/schema/ai-transcription/tables';
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
      fullName: `Patient ${patientId.slice(0, 8)}`,
    });
  });
}

afterEach(async () => {
  // Clean in reverse FK order, scoped to test users.
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
      dsql`DELETE FROM patients
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// ai_transcriptions — cross-tenant isolation
// ---------------------------------------------------------------------------

describe('ai_transcriptions RLS — cross-tenant isolation', () => {
  it('(a) user B cannot SELECT a transcription belonging to user A', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);

    const transcriptionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(aiTranscriptions).values({
        id: transcriptionId,
        userId: userA,
        patientId: patientA,
        source: 'manual_upload',
        status: 'pending',
      });
    });

    // User B sees nothing.
    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(aiTranscriptions);
    });
    expect(rows).toHaveLength(0);
  });

  it('(b) user B cannot INSERT a row forging user_id = A.id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);

    await expect(
      runAsUser(userB, async (db) => {
        await db.insert(aiTranscriptions).values({
          id: randomUUID(),
          userId: userA, // forged
          patientId: patientA,
          source: 'manual_upload',
          status: 'pending',
        });
      }),
    ).rejects.toThrow();
  });

  it('(c) user B cannot UPDATE a row belonging to user A', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);

    const transcriptionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(aiTranscriptions).values({
        id: transcriptionId,
        userId: userA,
        patientId: patientA,
        source: 'manual_upload',
        status: 'pending',
      });
    });

    // RLS silently ignores — no rows matched.
    await runAsUser(userB, async (db) => {
      await db
        .update(aiTranscriptions)
        .set({ status: 'ready' })
        .where(eq(aiTranscriptions.id, transcriptionId));
    });

    // Verify no change.
    const rows = await runAsService(async (db) => {
      return db.select().from(aiTranscriptions).where(eq(aiTranscriptions.id, transcriptionId));
    });
    expect(rows[0]!.status).toBe('pending');
  });

  it('(c) user B cannot DELETE a row belonging to user A', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);

    const transcriptionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(aiTranscriptions).values({
        id: transcriptionId,
        userId: userA,
        patientId: patientA,
        source: 'manual_upload',
        status: 'pending',
      });
    });

    // RLS silently ignores — no rows matched.
    await runAsUser(userB, async (db) => {
      await db.delete(aiTranscriptions).where(eq(aiTranscriptions.id, transcriptionId));
    });

    // Verify row still exists.
    const rows = await runAsService(async (db) => {
      return db.select().from(aiTranscriptions).where(eq(aiTranscriptions.id, transcriptionId));
    });
    expect(rows).toHaveLength(1);
  });

  it('(d) user A can read only their own rows', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);
    await seedPatient(userB, patientB);

    await runAsService(async (db) => {
      await db.insert(aiTranscriptions).values([
        {
          id: randomUUID(),
          userId: userA,
          patientId: patientA,
          source: 'manual_upload',
          status: 'pending',
        },
        {
          id: randomUUID(),
          userId: userB,
          patientId: patientB,
          source: 'video_session',
          status: 'pending',
        },
      ]);
    });

    const rowsA = await runAsUser(userA, async (db) => {
      return db.select().from(aiTranscriptions);
    });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]!.userId).toBe(userA);

    const rowsB = await runAsUser(userB, async (db) => {
      return db.select().from(aiTranscriptions);
    });
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.userId).toBe(userB);
  });
});

// ---------------------------------------------------------------------------
// ai_transcription_settings — cross-tenant isolation
// ---------------------------------------------------------------------------

describe('ai_transcription_settings RLS — cross-tenant isolation', () => {
  it('user B cannot SELECT settings belonging to user A', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await runAsService(async (db) => {
      await db.insert(aiTranscriptionSettings).values({
        id: randomUUID(),
        userId: userA,
        enabled: true,
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(aiTranscriptionSettings);
    });
    expect(rows).toHaveLength(0);
  });

  it('user B cannot INSERT settings forging user_id = A.id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await expect(
      runAsUser(userB, async (db) => {
        await db.insert(aiTranscriptionSettings).values({
          id: randomUUID(),
          userId: userA,
          enabled: true,
        });
      }),
    ).rejects.toThrow();
  });

  it('user A can INSERT and read their own settings', async () => {
    const userA = randomUUID();
    await seedAuthUser(userA);

    await runAsUser(userA, async (db) => {
      await db.insert(aiTranscriptionSettings).values({
        id: randomUUID(),
        userId: userA,
        enabled: true,
        defaultTemplate: 'tcc',
        keepAudioHours: 48,
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(aiTranscriptionSettings);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(true);
    expect(rows[0]!.defaultTemplate).toBe('tcc');
    expect(rows[0]!.keepAudioHours).toBe(48);
  });
});
