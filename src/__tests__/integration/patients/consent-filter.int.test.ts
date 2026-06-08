import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { listPatientsImpl } from '@/modules/patients/server/list-patients';
import { patientGuardians, patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
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

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as Parameters<typeof listPatientsImpl>[0];
}

type SeedPatient = {
  fullName: string;
  patientType?: string;
  status?: string;
  phone?: string | null;
  email?: string | null;
  tags?: string[];
  consentSignedAt?: Date | null;
  archivedAt?: Date | null;
};

/** Seed patients for a user. Returns the inserted ids in input order. */
async function seedPatients(userId: string, data: SeedPatient[]): Promise<string[]> {
  const ids: string[] = [];
  await runAsService(async (db) => {
    for (const item of data) {
      const id = randomUUID();
      ids.push(id);
      await db.insert(patients).values({
        id,
        userId,
        fullName: item.fullName,
        patientType: item.patientType ?? 'individual',
        status: item.status ?? 'active',
        phone: item.phone ?? null,
        email: item.email ?? null,
        tags: item.tags ?? [],
        consentSignedAt: item.consentSignedAt ?? null,
        archivedAt: item.archivedAt ?? null,
      });
    }
  });
  return ids;
}

/** Seed a primary guardian (with phone) for a minor patient. */
async function seedGuardian(
  patientId: string,
  phone: string | null,
  isPrimary = true,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patientGuardians).values({
      id: randomUUID(),
      patientId,
      fullName: 'Responsável Teste',
      relationship: 'mother',
      phone,
      isPrimary,
    });
  });
}

// The Testcontainers DB is reused across suites, so it may carry rows (e.g.
// ai_transcriptions) that reference patients via FK. Use the shared,
// FK-ordered cleaner instead of a hand-rolled `DELETE FROM patients`, and wipe
// once up front so a previous suite's leftovers can't skew our counts.
// patient_guardians cascade on the patients delete that cleanTestData performs.
beforeAll(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

// ---------------------------------------------------------------------------
// missingConsent predicate
// ---------------------------------------------------------------------------

describe('listPatientsImpl — missingConsent', () => {
  it('returns exactly the unsigned, non-archived patients', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedPatients(userId, [
      { fullName: 'Sem consentimento', consentSignedAt: null, archivedAt: null },
      { fullName: 'Sem consentimento 2', consentSignedAt: null, archivedAt: null },
      // Signed → excluded.
      { fullName: 'Assinou', consentSignedAt: new Date('2024-01-01'), archivedAt: null },
      // Archived (even though unsigned) → excluded.
      {
        fullName: 'Arquivado',
        status: 'archived',
        consentSignedAt: null,
        archivedAt: new Date('2024-02-01'),
      },
    ]);
    const client = fakeSupabaseClient(userId);

    const result = await listPatientsImpl(client, { missingConsent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(2);
    const names = result.patients.map((p) => p.fullName).sort();
    expect(names).toEqual(['Sem consentimento', 'Sem consentimento 2']);
  });

  it('rows and count stay consistent (header parity) under pagination', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedPatients(userId, [
      { fullName: 'Ana', consentSignedAt: null },
      { fullName: 'Bruno', consentSignedAt: null },
      { fullName: 'Carlos', consentSignedAt: null },
      // Signed — must not inflate the count.
      { fullName: 'Daniel', consentSignedAt: new Date('2024-01-01') },
    ]);
    const client = fakeSupabaseClient(userId);

    const page1 = await listPatientsImpl(client, {
      missingConsent: true,
      page: 1,
      pageSize: 2,
      sort: 'full_name',
      order: 'asc',
    });

    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    // count() reflects the full predicate set, not the page size.
    expect(page1.total).toBe(3);
    expect(page1.patients).toHaveLength(2);
    expect(page1.patients.map((p) => p.fullName)).toEqual(['Ana', 'Bruno']);
  });

  it('composes with search', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedPatients(userId, [
      { fullName: 'Maria Sem', consentSignedAt: null },
      { fullName: 'Maria Assinou', consentSignedAt: new Date('2024-01-01') },
      { fullName: 'João Sem', consentSignedAt: null },
    ]);
    const client = fakeSupabaseClient(userId);

    const result = await listPatientsImpl(client, { missingConsent: true, search: 'maria' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(1);
    expect(result.patients[0]!.fullName).toBe('Maria Sem');
  });

  it('composes with tags (AND logic)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedPatients(userId, [
      { fullName: 'Com tag sem consent', consentSignedAt: null, tags: ['ansiedade'] },
      { fullName: 'Com tag assinou', consentSignedAt: new Date('2024-01-01'), tags: ['ansiedade'] },
      { fullName: 'Sem tag sem consent', consentSignedAt: null, tags: [] },
    ]);
    const client = fakeSupabaseClient(userId);

    const result = await listPatientsImpl(client, {
      missingConsent: true,
      tags: ['ansiedade'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(1);
    expect(result.patients[0]!.fullName).toBe('Com tag sem consent');
  });

  it('returns empty when all unsigned patients are archived', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedPatients(userId, [
      {
        fullName: 'Arquivado 1',
        status: 'archived',
        consentSignedAt: null,
        archivedAt: new Date('2024-02-01'),
      },
      {
        fullName: 'Arquivado 2',
        status: 'archived',
        consentSignedAt: null,
        archivedAt: new Date('2024-03-01'),
      },
    ]);
    const client = fakeSupabaseClient(userId);

    const result = await listPatientsImpl(client, { missingConsent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(0);
    expect(result.patients).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // consentShare enrichment
  // -------------------------------------------------------------------------

  describe('consentShare', () => {
    it("uses the patient's own phone for an adult", async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      const [adultId] = await seedPatients(userId, [
        {
          fullName: 'Adulto Sem Consent',
          patientType: 'individual',
          phone: '+55 11 91111-1111',
          consentSignedAt: null,
        },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { missingConsent: true });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.consentShare).toBeDefined();
      const share = result.consentShare!.find((s) => s.patientId === adultId);
      expect(share?.sharePhone).toBe('+55 11 91111-1111');
    });

    it("uses the primary guardian's phone for a minor", async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      const [minorId] = await seedPatients(userId, [
        {
          fullName: 'Criança Sem Consent',
          patientType: 'child',
          phone: '+55 11 92222-2222', // patient phone must be IGNORED for minors
          consentSignedAt: null,
        },
      ]);
      await seedGuardian(minorId!, '+55 11 93333-3333', true);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { missingConsent: true });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const share = result.consentShare!.find((s) => s.patientId === minorId);
      expect(share?.sharePhone).toBe('+55 11 93333-3333');
    });

    it('resolves null sharePhone for a minor with no guardian phone', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      const [minorId] = await seedPatients(userId, [
        { fullName: 'Adolescente Sem Telefone', patientType: 'adolescent', consentSignedAt: null },
      ]);
      await seedGuardian(minorId!, null, true);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { missingConsent: true });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const share = result.consentShare!.find((s) => s.patientId === minorId);
      expect(share?.sharePhone).toBeNull();
    });

    it('is not present when missingConsent is not set', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [{ fullName: 'Qualquer', consentSignedAt: null }]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.consentShare).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant isolation (RN-12.02)
  // -------------------------------------------------------------------------

  it("never returns another psychologist's unconsented patients", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    await seedPatients(userA, [{ fullName: 'A sem consent', consentSignedAt: null }]);
    await seedPatients(userB, [
      { fullName: 'B sem consent 1', consentSignedAt: null },
      { fullName: 'B sem consent 2', consentSignedAt: null },
    ]);

    const clientA = fakeSupabaseClient(userA);
    const result = await listPatientsImpl(clientA, { missingConsent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(1);
    expect(result.patients[0]!.fullName).toBe('A sem consent');
    // No B row leaks into A's enrichment either.
    expect(result.consentShare).toHaveLength(1);
    expect(result.consentShare![0]!.patientId).toBe(result.patients[0]!.id);
  });

  it("does not borrow another tenant's guardian phone for a same-shaped minor", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);

    const [minorA] = await seedPatients(userA, [
      { fullName: 'Minor A', patientType: 'child', consentSignedAt: null },
    ]);
    await seedGuardian(minorA!, '+55 11 94444-4444', true);

    // B has its own minor + guardian; must never bleed into A's listing.
    const [minorB] = await seedPatients(userB, [
      { fullName: 'Minor B', patientType: 'child', consentSignedAt: null },
    ]);
    await seedGuardian(minorB!, '+55 11 95555-5555', true);

    const clientA = fakeSupabaseClient(userA);
    const result = await listPatientsImpl(clientA, { missingConsent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(1);
    const share = result.consentShare!.find((s) => s.patientId === minorA);
    expect(share?.sharePhone).toBe('+55 11 94444-4444');
  });
});
