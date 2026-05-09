import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { checkCsvDuplicatesImpl } from '@/modules/patients/server/check-csv-duplicates';
import { importPatientsCsvImpl } from '@/modules/patients/server/import-patients-csv';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a row in `auth.users` so the FK constraint on `patients.user_id` is
 * satisfied. Same pattern as other patient integration tests.
 */
async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

/**
 * Build a minimal fake Supabase client that returns a specific user for
 * `auth.getUser()`. Isolates server action logic from real Supabase Auth.
 */
function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof importPatientsCsvImpl>[0];
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// importPatientsCsvImpl
// ---------------------------------------------------------------------------

describe('importPatientsCsvImpl', () => {
  it('imports 10 valid rows in a single batch', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const rows = Array.from({ length: 10 }, (_, i) => ({
      fullName: `Paciente ${i + 1}`,
      phone: `+55 11 9${String(1000 + i).slice(0, 4)}-${String(5000 + i).slice(0, 4)}`,
      email: `patient${i + 1}@example.com`,
    }));

    const result = await importPatientsCsvImpl(client, rows);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importedCount).toBe(10);

    // Verify all rows exist in the database
    const dbRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });
    expect(dbRows).toHaveLength(10);

    // All should be adult + active as per spec
    for (const row of dbRows) {
      expect(row.patientType).toBe('adult');
      expect(row.status).toBe('active');
      expect(row.userId).toBe(userId);
    }
  });

  it('sets patient_type to adult and status to active for all imported rows', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await importPatientsCsvImpl(client, [
      { fullName: 'Maria Silva', phone: '+55 11 91234-5678' },
    ]);

    expect(result.ok).toBe(true);

    const dbRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.patientType).toBe('adult');
    expect(dbRows[0]!.status).toBe('active');
  });

  it('rolls back entire batch when a DB error occurs', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Insert a patient with a specific email to trigger unique constraint violation.
    // The DB has a partial unique index on (user_id, email) WHERE email IS NOT NULL.
    await runAsService(async (db) => {
      await db.insert(patients).values({
        userId,
        fullName: 'Existing Patient',
        email: 'taken@example.com',
        patientType: 'adult',
        status: 'active',
      });
    });

    // Try to import a batch where the second row has the same email as existing
    // patient. Since this is a batch insert in a transaction, the entire batch
    // should fail and roll back — including the first (valid) row.
    const rows = [
      { fullName: 'New Patient 1', email: 'fresh@example.com' },
      { fullName: 'New Patient 2', email: 'taken@example.com' }, // duplicate email
    ];

    const result = await importPatientsCsvImpl(client, rows);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('db_error');
    if (result.error !== 'db_error') return;
    expect(result.message).toBe('Erro ao importar. Nenhum paciente foi criado. Tente novamente.');

    // Verify no new patients were inserted (only the pre-existing one remains)
    const dbRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.fullName).toBe('Existing Patient');
  });

  it('rejects more than 200 rows', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const rows = Array.from({ length: 201 }, (_, i) => ({
      fullName: `Paciente ${i + 1}`,
    }));

    const result = await importPatientsCsvImpl(client, rows);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('too_many_rows');
    if (result.error !== 'too_many_rows') return;
    expect(result.message).toBe('Máximo de 200 linhas por importação. Seu arquivo tem 201.');

    // Verify nothing was inserted
    const dbRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });
    expect(dbRows).toHaveLength(0);
  });

  it('accepts exactly 200 rows', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const rows = Array.from({ length: 200 }, (_, i) => ({
      fullName: `Paciente ${i + 1}`,
    }));

    const result = await importPatientsCsvImpl(client, rows);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importedCount).toBe(200);
  });

  it('rejects empty array', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await importPatientsCsvImpl(client, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('empty');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);

    const result = await importPatientsCsvImpl(client, [{ fullName: 'Test Patient' }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('parses DD/MM/YYYY birth dates correctly', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await importPatientsCsvImpl(client, [
      { fullName: 'Maria Silva', birthDate: '15/03/1990' },
    ]);

    expect(result.ok).toBe(true);

    const dbRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });
    expect(dbRows).toHaveLength(1);
    const birthDate = dbRows[0]!.birthDate;
    expect(birthDate).not.toBeNull();
    // The date should represent March 15, 1990
    expect(birthDate!.getFullYear()).toBe(1990);
    expect(birthDate!.getMonth()).toBe(2); // 0-indexed
    expect(birthDate!.getDate()).toBe(15);
  });

  it('parses YYYY-MM-DD birth dates correctly', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await importPatientsCsvImpl(client, [
      { fullName: 'João Santos', birthDate: '1985-07-22' },
    ]);

    expect(result.ok).toBe(true);

    const dbRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });
    expect(dbRows).toHaveLength(1);
    const birthDate = dbRows[0]!.birthDate;
    expect(birthDate).not.toBeNull();
    expect(birthDate!.getFullYear()).toBe(1985);
    expect(birthDate!.getMonth()).toBe(6); // 0-indexed
    expect(birthDate!.getDate()).toBe(22);
  });

  it('stores tags as array', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await importPatientsCsvImpl(client, [
      { fullName: 'Ana Costa', tags: ['ansiedade', 'tcc'] },
    ]);

    expect(result.ok).toBe(true);

    const dbRows = await runAsService(async (db) => {
      return db.select().from(patients).where(eq(patients.userId, userId));
    });
    expect(dbRows[0]!.tags).toEqual(['ansiedade', 'tcc']);
  });
});

// ---------------------------------------------------------------------------
// checkCsvDuplicatesImpl
// ---------------------------------------------------------------------------

describe('checkCsvDuplicatesImpl', () => {
  it('detects duplicate phones for the same psychologist', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Seed existing patient with a phone
    await runAsService(async (db) => {
      await db.insert(patients).values({
        userId,
        fullName: 'Existing Patient',
        phone: '+55 11 91234-5678',
        patientType: 'adult',
        status: 'active',
      });
    });

    const result = await checkCsvDuplicatesImpl(client, [
      { phone: '+55 11 91234-5678' },
      { phone: '+55 11 99876-5432' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicatePhones).toContain('+55 11 91234-5678');
    expect(result.duplicatePhones).not.toContain('+55 11 99876-5432');
    expect(result.duplicateEmails).toHaveLength(0);
  });

  it('detects duplicate emails for the same psychologist', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Seed existing patient with an email
    await runAsService(async (db) => {
      await db.insert(patients).values({
        userId,
        fullName: 'Existing Patient',
        email: 'existing@example.com',
        patientType: 'adult',
        status: 'active',
      });
    });

    const result = await checkCsvDuplicatesImpl(client, [
      { email: 'existing@example.com' },
      { email: 'new@example.com' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicateEmails).toContain('existing@example.com');
    expect(result.duplicateEmails).not.toContain('new@example.com');
    expect(result.duplicatePhones).toHaveLength(0);
  });

  it('does not flag duplicates from a different psychologist', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    // Seed patient for user A
    await runAsService(async (db) => {
      await db.insert(patients).values({
        userId: userA,
        fullName: 'Patient of A',
        phone: '+55 11 91234-5678',
        email: 'shared@example.com',
        patientType: 'adult',
        status: 'active',
      });
    });

    // Check duplicates as user B — should find none
    const clientB = fakeSupabaseClient(userB);
    const result = await checkCsvDuplicatesImpl(clientB, [
      { phone: '+55 11 91234-5678', email: 'shared@example.com' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicatePhones).toHaveLength(0);
    expect(result.duplicateEmails).toHaveLength(0);
  });

  it('handles mixed phone and email duplicates', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Seed existing patients
    await runAsService(async (db) => {
      await db.insert(patients).values([
        {
          userId,
          fullName: 'Patient 1',
          phone: '+55 11 91234-5678',
          patientType: 'adult',
          status: 'active',
        },
        {
          userId,
          fullName: 'Patient 2',
          email: 'taken@example.com',
          patientType: 'adult',
          status: 'active',
        },
      ]);
    });

    const result = await checkCsvDuplicatesImpl(client, [
      { phone: '+55 11 91234-5678', email: 'new@example.com' },
      { phone: '+55 11 99999-9999', email: 'taken@example.com' },
      { phone: '+55 11 98888-8888', email: 'fresh@example.com' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicatePhones).toEqual(['+55 11 91234-5678']);
    expect(result.duplicateEmails).toEqual(['taken@example.com']);
  });

  it('returns empty arrays when no candidates have phone/email', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await checkCsvDuplicatesImpl(client, [
      { phone: null, email: null },
      { phone: '', email: '' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicatePhones).toHaveLength(0);
    expect(result.duplicateEmails).toHaveLength(0);
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);

    const result = await checkCsvDuplicatesImpl(client, [{ phone: '+55 11 91234-5678' }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  it('deduplicates input candidates before querying', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    // Seed existing patient
    await runAsService(async (db) => {
      await db.insert(patients).values({
        userId,
        fullName: 'Existing',
        phone: '+55 11 91234-5678',
        patientType: 'adult',
        status: 'active',
      });
    });

    // Send same phone multiple times in candidates
    const result = await checkCsvDuplicatesImpl(client, [
      { phone: '+55 11 91234-5678' },
      { phone: '+55 11 91234-5678' },
      { phone: '+55 11 91234-5678' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should only contain the phone once, not three times
    expect(result.duplicatePhones).toEqual(['+55 11 91234-5678']);
  });
});
