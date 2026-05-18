import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { clinicalDocuments } from '@/shared/db/schema/medical-records/tables';
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

async function seedDraftDocument(
  userId: string,
  patientId: string,
  overrides?: Partial<{
    id: string;
    documentType: string;
    status: string;
    finalizedAt: Date;
  }>,
): Promise<string> {
  const docId = overrides?.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(clinicalDocuments).values({
      id: docId,
      userId,
      patientId,
      documentType: overrides?.documentType ?? 'declaracao',
      title: 'Test Document',
      content: { body: 'test content' },
      status: overrides?.status ?? 'draft',
      finalizedAt: overrides?.finalizedAt ?? null,
    });
  });
  return docId;
}

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// Table existence
// =====================================================================

describe('clinical_documents — table existence', () => {
  it('clinical_documents table exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'clinical_documents'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

// =====================================================================
// RLS enabled
// =====================================================================

describe('clinical_documents — RLS enabled', () => {
  it('RLS is enabled on clinical_documents', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'clinical_documents'`,
      );
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });
});

// =====================================================================
// RLS policies (SELECT/INSERT/UPDATE, no DELETE)
// =====================================================================

describe('clinical_documents — RLS policies', () => {
  it('has exactly 3 policies: SELECT, INSERT, UPDATE (no DELETE)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'clinical_documents'::regclass
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

  it('owner can read their own documents', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedDraftDocument(userId, patientId);

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(clinicalDocuments);
    });

    expect(rows).toHaveLength(1);
  });

  it('non-owner cannot SELECT another user documents', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    await seedDraftDocument(userA, patientId);

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(clinicalDocuments);
    });

    expect(rows).toHaveLength(0);
  });

  it('non-owner cannot UPDATE another user documents', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);
    const docId = await seedDraftDocument(userA, patientId);

    const result = await runAsUser(userB, async (db) => {
      return db
        .update(clinicalDocuments)
        .set({ title: 'Hacked' })
        .where(eq(clinicalDocuments.id, docId))
        .returning();
    });

    expect(result).toHaveLength(0);

    // Verify original title unchanged
    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows[0]!.title).toBe('Test Document');
  });
});

// =====================================================================
// No DELETE policy (Lei 13.787/2018)
// =====================================================================

describe('clinical_documents — no DELETE policy (Lei 13.787/2018)', () => {
  it('clinical_documents has no DELETE policy', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname FROM pg_policy
             WHERE polrelid = 'clinical_documents'::regclass AND polcmd = 'd'`,
      );
    });

    expect(result).toHaveLength(0);
  });
});

// =====================================================================
// UPDATE on finalized row returns 0 rows (RLS USING clause)
// =====================================================================

describe('clinical_documents — finalized-update protection', () => {
  it('UPDATE on finalized document returns 0 rows affected (RLS blocks it)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      status: 'finalized',
      finalizedAt: new Date(),
    });

    // Owner tries to update their own finalized document — RLS blocks it
    const result = await runAsUser(userId, async (db) => {
      return db
        .update(clinicalDocuments)
        .set({ title: 'Attempted edit' })
        .where(eq(clinicalDocuments.id, docId))
        .returning();
    });

    expect(result).toHaveLength(0);

    // Verify original title unchanged via service-role
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows[0]!.title).toBe('Test Document');
  });

  it('owner can still SELECT their finalized documents', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedDraftDocument(userId, patientId, {
      status: 'finalized',
      finalizedAt: new Date(),
    });

    const rows = await runAsUser(userId, async (db) => {
      return db.select().from(clinicalDocuments);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('finalized');
  });

  it('owner can UPDATE their draft documents', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId);

    const result = await runAsUser(userId, async (db) => {
      return db
        .update(clinicalDocuments)
        .set({ title: 'Updated title' })
        .where(eq(clinicalDocuments.id, docId))
        .returning();
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Updated title');
  });
});

// =====================================================================
// CHECK constraints
// =====================================================================

describe('clinical_documents — CHECK constraint on document_type', () => {
  it('allows valid document_type values', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const validTypes = ['declaracao', 'atestado', 'relatorio', 'laudo', 'parecer'] as const;

    for (const docType of validTypes) {
      await runAsService(async (db) => {
        await db.insert(clinicalDocuments).values({
          id: randomUUID(),
          userId,
          patientId,
          documentType: docType,
          title: `Test ${docType}`,
          content: {},
        });
      });
    }

    const count = await runAsService(async (db) => {
      const rows = await db
        .select()
        .from(clinicalDocuments)
        .where(eq(clinicalDocuments.patientId, patientId));
      return rows.length;
    });

    expect(count).toBe(validTypes.length);
  });

  it('rejects invalid document_type value', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(clinicalDocuments).values({
          id: randomUUID(),
          userId,
          patientId,
          documentType: 'invalid-type',
          title: 'Test',
          content: {},
        });
      }),
    ).rejects.toThrow();
  });
});

describe('clinical_documents — CHECK constraint on status', () => {
  it('allows valid status values', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const validStatuses = ['draft', 'finalized'] as const;

    for (const status of validStatuses) {
      await runAsService(async (db) => {
        await db.insert(clinicalDocuments).values({
          id: randomUUID(),
          userId,
          patientId,
          documentType: 'declaracao',
          title: `Test ${status}`,
          content: {},
          status,
        });
      });
    }

    const count = await runAsService(async (db) => {
      const rows = await db
        .select()
        .from(clinicalDocuments)
        .where(eq(clinicalDocuments.patientId, patientId));
      return rows.length;
    });

    expect(count).toBe(validStatuses.length);
  });

  it('rejects invalid status value', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(clinicalDocuments).values({
          id: randomUUID(),
          userId,
          patientId,
          documentType: 'declaracao',
          title: 'Test',
          content: {},
          status: 'published',
        });
      }),
    ).rejects.toThrow();
  });
});

describe('clinical_documents — CHECK constraint on signature_method', () => {
  it('allows valid signature_method values and NULL', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const validMethods = ['icp-brasil', 'manual', null] as const;

    for (const method of validMethods) {
      await runAsService(async (db) => {
        await db.insert(clinicalDocuments).values({
          id: randomUUID(),
          userId,
          patientId,
          documentType: 'declaracao',
          title: `Test ${method ?? 'null'}`,
          content: {},
          signatureMethod: method,
        });
      });
    }

    const count = await runAsService(async (db) => {
      const rows = await db
        .select()
        .from(clinicalDocuments)
        .where(eq(clinicalDocuments.patientId, patientId));
      return rows.length;
    });

    expect(count).toBe(validMethods.length);
  });

  it('rejects invalid signature_method value', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await expect(
      runAsService(async (db) => {
        await db.insert(clinicalDocuments).values({
          id: randomUUID(),
          userId,
          patientId,
          documentType: 'declaracao',
          title: 'Test',
          content: {},
          signatureMethod: 'pgp-sign',
        });
      }),
    ).rejects.toThrow();
  });
});

// =====================================================================
// Indexes
// =====================================================================

describe('clinical_documents — indexes', () => {
  it('has index on (patient_id, document_type, created_at)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'clinical_documents'
             AND indexname = 'idx_clinical_docs_patient_type_created'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('has index on (status, finalized_at)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'clinical_documents'
             AND indexname = 'idx_clinical_docs_status_finalized'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('has index on user_id (for RLS performance)', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'clinical_documents'
             AND indexname = 'idx_clinical_docs_user_id'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});
