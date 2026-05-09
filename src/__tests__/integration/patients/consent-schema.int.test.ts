import { randomUUID, randomBytes } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { consentTerms } from '@/shared/db/schema/patients/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// Helper: create a row in `auth.users` so FK constraints are satisfied.
async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

// Helper: create a patient owned by `userId` and return its id.
async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
    });
  });
}

// Helper: generate a 64-char hex signature token.
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(consentTerms);
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

describe('consent_terms table — schema verification', () => {
  it('table consent_terms exists', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'consent_terms'`,
      );
    });

    expect(result).toHaveLength(1);
  });

  it('has all expected columns with correct types', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'consent_terms'
             ORDER BY ordinal_position`,
      );
    });

    const columns = result.map((r) => ({
      name: r.column_name as string,
      type: r.data_type as string,
      nullable: r.is_nullable as string,
    }));

    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', type: 'uuid', nullable: 'NO' }),
        expect.objectContaining({ name: 'patient_id', type: 'uuid', nullable: 'NO' }),
        expect.objectContaining({ name: 'user_id', type: 'uuid', nullable: 'NO' }),
        expect.objectContaining({ name: 'term_text', type: 'text', nullable: 'NO' }),
        expect.objectContaining({
          name: 'signature_token',
          type: 'character varying',
          nullable: 'NO',
        }),
        expect.objectContaining({
          name: 'signed_at',
          type: 'timestamp with time zone',
          nullable: 'YES',
        }),
        expect.objectContaining({ name: 'signed_ip', type: 'text', nullable: 'YES' }),
        expect.objectContaining({ name: 'signed_user_agent', type: 'text', nullable: 'YES' }),
        expect.objectContaining({ name: 'signed_pdf_path', type: 'text', nullable: 'YES' }),
        expect.objectContaining({
          name: 'revoked_at',
          type: 'timestamp with time zone',
          nullable: 'YES',
        }),
        expect.objectContaining({
          name: 'created_at',
          type: 'timestamp with time zone',
          nullable: 'NO',
        }),
      ]),
    );

    expect(columns).toHaveLength(11);
  });

  it('accepts inserts via service role', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const consentId = randomUUID();
    const token = generateToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: consentId,
        patientId,
        userId,
        termText: 'Eu autorizo o tratamento dos meus dados pessoais...',
        signatureToken: token,
      });
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, consentId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.termText).toBe('Eu autorizo o tratamento dos meus dados pessoais...');
    expect(rows[0]!.signatureToken).toBe(token);
    expect(rows[0]!.signedAt).toBeNull();
    expect(rows[0]!.signedIp).toBeNull();
    expect(rows[0]!.signedUserAgent).toBeNull();
    expect(rows[0]!.signedPdfPath).toBeNull();
    expect(rows[0]!.revokedAt).toBeNull();
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
  });
});

describe('consent_terms table — UNIQUE constraint on signature_token', () => {
  it('enforces uniqueness — duplicate token insert fails', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const token = generateToken();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: randomUUID(),
        patientId,
        userId,
        termText: 'First term',
        signatureToken: token,
      });
    });

    await expect(
      runAsService(async (db) => {
        await db.insert(consentTerms).values({
          id: randomUUID(),
          patientId,
          userId,
          termText: 'Duplicate token term',
          signatureToken: token,
        });
      }),
    ).rejects.toThrow();
  });

  it('allows different tokens for the same patient', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values([
        {
          id: randomUUID(),
          patientId,
          userId,
          termText: 'Term v1',
          signatureToken: generateToken(),
        },
        {
          id: randomUUID(),
          patientId,
          userId,
          termText: 'Term v2',
          signatureToken: generateToken(),
        },
      ]);
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });

    expect(rows).toHaveLength(2);
  });
});

describe('consent_terms table — FK cascade', () => {
  it('deleting a patient cascades to its consent terms', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: randomUUID(),
        patientId,
        userId,
        termText: 'Will be cascaded',
        signatureToken: generateToken(),
      });
    });

    // Verify consent term exists before deletion
    const before = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });
    expect(before).toHaveLength(1);

    // Delete the parent patient
    await runAsService(async (db) => {
      await db.delete(patients).where(eq(patients.id, patientId));
    });

    // Consent term should be gone
    const after = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.patientId, patientId));
    });
    expect(after).toHaveLength(0);
  });

  it('rejects insert with non-existent patient_id', async () => {
    const userId = randomUUID();
    const fakePatientId = randomUUID();
    await seedAuthUser(userId);

    await expect(
      runAsService(async (db) => {
        await db.insert(consentTerms).values({
          id: randomUUID(),
          patientId: fakePatientId,
          userId,
          termText: 'Orphan consent term',
          signatureToken: generateToken(),
        });
      }),
    ).rejects.toThrow();
  });
});

describe('consent_terms table — RLS policies', () => {
  it('RLS is enabled on consent_terms table', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(dsql`SELECT relrowsecurity FROM pg_class WHERE relname = 'consent_terms'`);
    });

    expect(result[0]!.relrowsecurity).toBe(true);
  });

  it('has all four owner-scoped policies', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT polname, polcmd FROM pg_policy
             WHERE polrelid = 'consent_terms'::regclass
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

  it('owner can read their own consent terms', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const consentId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: consentId,
        patientId,
        userId: userA,
        termText: 'Consent term of A',
        signatureToken: generateToken(),
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(consentTerms);
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(consentId);
  });

  it("non-owner cannot read another user's consent terms", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: randomUUID(),
        patientId,
        userId: userA,
        termText: 'Private consent term',
        signatureToken: generateToken(),
      });
    });

    const rows = await runAsUser(userB, async (db) => {
      return db.select().from(consentTerms);
    });

    expect(rows).toHaveLength(0);
  });

  it('owner can insert consent terms with their own user_id', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsUser(userA, async (db) => {
      await db.insert(consentTerms).values({
        id: randomUUID(),
        patientId,
        userId: userA,
        termText: 'New consent term',
        signatureToken: generateToken(),
      });
    });

    const rows = await runAsUser(userA, async (db) => {
      return db.select().from(consentTerms);
    });

    expect(rows).toHaveLength(1);
  });

  it('owner cannot insert consent terms with another user_id', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userB, patientId);

    await expect(
      runAsUser(userA, async (db) => {
        await db.insert(consentTerms).values({
          id: randomUUID(),
          patientId,
          userId: userB,
          termText: 'Hijack attempt',
          signatureToken: generateToken(),
        });
      }),
    ).rejects.toThrow();
  });

  it('owner can update their own consent terms', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const consentId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: consentId,
        patientId,
        userId: userA,
        termText: 'Original term',
        signatureToken: generateToken(),
      });
    });

    await runAsUser(userA, async (db) => {
      await db
        .update(consentTerms)
        .set({ termText: 'Updated term' })
        .where(eq(consentTerms.id, consentId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, consentId));
    });

    expect(rows[0]!.termText).toBe('Updated term');
  });

  it("non-owner cannot update another user's consent terms", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const consentId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: consentId,
        patientId,
        userId: userA,
        termText: 'Original term',
        signatureToken: generateToken(),
      });
    });

    // Won't throw — RLS silently filters, no rows matched
    await runAsUser(userB, async (db) => {
      await db
        .update(consentTerms)
        .set({ termText: 'Hijacked term' })
        .where(eq(consentTerms.id, consentId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, consentId));
    });

    expect(rows[0]!.termText).toBe('Original term');
  });

  it('owner can delete their own consent terms', async () => {
    const userA = randomUUID();
    const patientId = randomUUID();
    const consentId = randomUUID();
    await seedAuthUser(userA);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: consentId,
        patientId,
        userId: userA,
        termText: 'To be deleted',
        signatureToken: generateToken(),
      });
    });

    await runAsUser(userA, async (db) => {
      await db.delete(consentTerms).where(eq(consentTerms.id, consentId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, consentId));
    });

    expect(rows).toHaveLength(0);
  });

  it("non-owner cannot delete another user's consent terms", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const consentId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values({
        id: consentId,
        patientId,
        userId: userA,
        termText: 'Protected consent term',
        signatureToken: generateToken(),
      });
    });

    await runAsUser(userB, async (db) => {
      await db.delete(consentTerms).where(eq(consentTerms.id, consentId));
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(consentTerms).where(eq(consentTerms.id, consentId));
    });

    expect(rows).toHaveLength(1);
  });

  it('service-role connection bypasses RLS and sees all consent terms', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientA);
    await seedPatient(userB, patientB);

    await runAsService(async (db) => {
      await db.insert(consentTerms).values([
        {
          id: randomUUID(),
          patientId: patientA,
          userId: userA,
          termText: 'Consent A',
          signatureToken: generateToken(),
        },
        {
          id: randomUUID(),
          patientId: patientB,
          userId: userB,
          termText: 'Consent B',
          signatureToken: generateToken(),
        },
      ]);
    });

    const rows = await runAsService(async (db) => db.select().from(consentTerms));
    expect(rows).toHaveLength(2);
  });
});

describe('consent_terms table — indexes', () => {
  it('has index on patient_id', async () => {
    const result = await runAsService(async (db) => {
      return db.execute(
        dsql`SELECT indexname FROM pg_indexes
             WHERE tablename = 'consent_terms' AND indexname = 'consent_terms_patient_id_idx'`,
      );
    });

    expect(result).toHaveLength(1);
  });
});

describe('consent_terms — policy coverage in migrations', () => {
  it('consent_terms table has CREATE POLICY statements in migrations', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fg = await import('fast-glob');

    const ROOT = path.resolve(__dirname, '../../../..');
    const files = await fg.default('src/shared/db/migrations/**/*.sql', {
      cwd: ROOT,
      absolute: true,
    });

    let hasConsentPolicy = false;
    const pattern = /CREATE\s+POLICY\b[^;]+\bON\s+["`]?consent_terms["`]?/gi;

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (pattern.test(source)) {
        hasConsentPolicy = true;
        break;
      }
    }

    expect(hasConsentPolicy).toBe(true);
  });
});
