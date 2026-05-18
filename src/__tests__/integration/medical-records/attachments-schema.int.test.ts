import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { evolutionAttachments, personalNotes } from '@/shared/db/schema/medical-records/tables';
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

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// Table existence
// =====================================================================

describe('evolution_attachments — table existence', () => {
  it('evolution_attachments table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'evolution_attachments'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

describe('personal_notes — table existence', () => {
  it('personal_notes table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'personal_notes'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// RLS enabled
// =====================================================================

describe('evolution_attachments — RLS enabled', () => {
  it('RLS is enabled on evolution_attachments', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'evolution_attachments'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

describe('personal_notes — RLS enabled', () => {
  it('RLS is enabled on personal_notes', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'personal_notes'`);
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

// =====================================================================
// RLS policies — evolution_attachments (SELECT/INSERT/UPDATE, no DELETE)
// =====================================================================

describe('evolution_attachments — RLS policies', () => {
  it('has exactly 3 policies: SELECT, INSERT, UPDATE (no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'evolution_attachments'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    // r=SELECT, a=INSERT, w=UPDATE, d=DELETE
    expect(policies).toHaveLength(3);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeUndefined(); // NO DELETE
  });

  it('owner can read their own attachments', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(evolutionAttachments).values({
        id: randomUUID(),
        userId,
        patientId,
        fileName: 'abc123.pdf',
        displayName: 'exam-result.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        storagePath: `${userId}/${patientId}/abc123.pdf`,
        category: 'exam',
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(evolutionAttachments);
    });

    expect(rows).toHaveLength(1);
  });

  it('non-owner cannot read another user attachments', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(evolutionAttachments).values({
        id: randomUUID(),
        userId: userA,
        patientId,
        fileName: 'abc123.pdf',
        displayName: 'exam-result.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        storagePath: `${userA}/${patientId}/abc123.pdf`,
        category: 'exam',
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(evolutionAttachments);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// RLS policies — personal_notes (SELECT/INSERT/UPDATE, no DELETE)
// =====================================================================

describe('personal_notes — RLS policies', () => {
  it('has exactly 3 policies: SELECT, INSERT, UPDATE (no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'personal_notes'::regclass
             ORDER BY polname`,
      );
    });

    const policies = result.map((r) => ({
      name: r.polname as string,
      cmd: r.polcmd as string,
    }));

    // r=SELECT, a=INSERT, w=UPDATE, d=DELETE
    expect(policies).toHaveLength(3);
    expect(policies.find((p) => p.cmd === 'r')).toBeDefined(); // SELECT
    expect(policies.find((p) => p.cmd === 'a')).toBeDefined(); // INSERT
    expect(policies.find((p) => p.cmd === 'w')).toBeDefined(); // UPDATE
    expect(policies.find((p) => p.cmd === 'd')).toBeUndefined(); // NO DELETE
  });

  it('owner can read their own personal notes', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(personalNotes).values({
        id: randomUUID(),
        userId,
        patientId,
        content: '<p>Private reflection</p>',
      });
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(personalNotes);
    });

    expect(rows).toHaveLength(1);
  });

  it('non-owner cannot read another user personal notes', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(personalNotes).values({
        id: randomUUID(),
        userId: userA,
        patientId,
        content: '<p>Secret notes</p>',
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(personalNotes);
    });

    expect(rows).toHaveLength(0);
  });
});

// =====================================================================
// No DELETE policy (Lei 13.787/2018)
// =====================================================================

describe('evolution_attachments — no DELETE policy (Lei 13.787/2018)', () => {
  it('evolution_attachments has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'evolution_attachments'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });
});

describe('personal_notes — no DELETE policy (Lei 13.787/2018)', () => {
  it('personal_notes has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'personal_notes'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });
});

// =====================================================================
// UNIQUE constraint on personal_notes.patient_id
// =====================================================================

describe('personal_notes — UNIQUE constraint on patient_id', () => {
  it('enforces one personal note per patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(personalNotes).values({
        id: randomUUID(),
        userId,
        patientId,
        content: '<p>First note</p>',
      });
    });

    // Inserting a second row with the same patient_id should fail
    await expect(
      runAsService(async (db) => {
        await db.insert(personalNotes).values({
          id: randomUUID(),
          userId,
          patientId,
          content: '<p>Duplicate note</p>',
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// CHECK constraint on evolution_attachments.category
// =====================================================================

describe('evolution_attachments — CHECK constraint on category', () => {
  it('allows valid category values', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const validCategories = ['exam', 'image', 'drawing', 'audio', 'other'] as const;

    for (const category of validCategories) {
      await runAsService(async (db) => {
        await db.insert(evolutionAttachments).values({
          id: randomUUID(),
          userId,
          patientId,
          fileName: `${randomUUID()}.pdf`,
          displayName: `test-${category}.pdf`,
          fileSize: 512,
          mimeType: 'application/pdf',
          storagePath: `${userId}/${patientId}/${randomUUID()}.pdf`,
          category,
        });
      });
    }

    const count = await runAsService(async (db) => {
      const rows = await db
        .select()
        .from(evolutionAttachments)
        .where(eq(evolutionAttachments.patientId, patientId));
      return rows.length;
    });

    expect(count).toBe(validCategories.length);
  });

  it('rejects invalid category value', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(evolutionAttachments).values({
          id: randomUUID(),
          userId,
          patientId,
          fileName: 'abc.pdf',
          displayName: 'test.pdf',
          fileSize: 512,
          mimeType: 'application/pdf',
          storagePath: `${userId}/${patientId}/abc.pdf`,
          category: 'invalid-category',
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// Indexes
// =====================================================================

describe('evolution_attachments — indexes', () => {
  it('has index on (patient_id, uploaded_at)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'evolution_attachments'
             AND indexname = 'idx_attachments_patient_uploaded'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('has index on user_id (for RLS performance)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'evolution_attachments'
             AND indexname = 'idx_attachments_user_id'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

describe('personal_notes — indexes', () => {
  it('has index on user_id (for RLS performance)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'personal_notes'
             AND indexname = 'idx_personal_notes_user_id'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});
