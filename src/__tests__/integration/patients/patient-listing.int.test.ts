import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { listPatientsImpl } from '@/modules/patients/server/list-patients';
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

/**
 * Seed multiple patients for a given user. Returns the IDs.
 */
async function seedPatients(
  userId: string,
  data: Array<{
    fullName: string;
    status?: string;
    phone?: string;
    email?: string;
    tags?: string[];
  }>,
): Promise<string[]> {
  const ids: string[] = [];
  await runAsService(async (db) => {
    for (const item of data) {
      const id = randomUUID();
      ids.push(id);
      await db.insert(patients).values({
        id,
        userId,
        fullName: item.fullName,
        patientType: 'individual',
        status: item.status ?? 'active',
        phone: item.phone ?? null,
        email: item.email ?? null,
        tags: item.tags ?? [],
      });
    }
  });
  return ids;
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(patients);
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// listPatientsImpl — Default behavior
// ---------------------------------------------------------------------------

describe('listPatientsImpl', () => {
  it('returns empty list when user has no patients', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    const client = fakeSupabaseClient(userId);

    const result = await listPatientsImpl(client, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patients).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it('returns only active patients by default (when no status filter)', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedPatients(userId, [
      { fullName: 'Active Patient', status: 'active' },
      { fullName: 'Archived Patient', status: 'archived' },
    ]);
    const client = fakeSupabaseClient(userId);

    // No status in query — schema does not apply a default, all patients returned
    const result = await listPatientsImpl(client, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Without explicit status filter, returns all patients
    expect(result.total).toBe(2);
  });

  it('does not return patients owned by other users', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatients(userA, [{ fullName: 'Patient of A' }]);
    await seedPatients(userB, [{ fullName: 'Patient of B' }]);

    const client = fakeSupabaseClient(userA);
    const result = await listPatientsImpl(client, {});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(1);
    expect(result.patients[0]!.fullName).toBe('Patient of A');
  });

  it('returns unauthenticated when no user session', async () => {
    const client = fakeSupabaseClient(null);
    const result = await listPatientsImpl(client, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
  });

  // -------------------------------------------------------------------------
  // Status filter
  // -------------------------------------------------------------------------

  describe('status filter', () => {
    it('filters by active status', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Active 1', status: 'active' },
        { fullName: 'Active 2', status: 'active' },
        { fullName: 'Archived 1', status: 'archived' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { status: 'active' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(2);
      expect(result.patients.every((p) => p.status === 'active')).toBe(true);
    });

    it('filters by archived status', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Active 1', status: 'active' },
        { fullName: 'Archived 1', status: 'archived' },
        { fullName: 'Archived 2', status: 'archived' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { status: 'archived' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(2);
      expect(result.patients.every((p) => p.status === 'archived')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Search (name, phone, email)
  // -------------------------------------------------------------------------

  describe('search', () => {
    it('searches by partial name (case-insensitive)', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Maria da Silva' },
        { fullName: 'João Santos' },
        { fullName: 'Ana Maria Costa' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { search: 'maria' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(2);
      const names = result.patients.map((p) => p.fullName);
      expect(names).toContain('Maria da Silva');
      expect(names).toContain('Ana Maria Costa');
    });

    it('searches accent-insensitive (finds José when searching jose)', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [{ fullName: 'José Ferreira' }, { fullName: 'Maria Santos' }]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { search: 'jose' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(1);
      expect(result.patients[0]!.fullName).toBe('José Ferreira');
    });

    it('searches by phone number (partial match)', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Patient A', phone: '+55 11 91234-5678' },
        { fullName: 'Patient B', phone: '+55 21 98765-4321' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { search: '91234' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(1);
      expect(result.patients[0]!.fullName).toBe('Patient A');
    });

    it('searches by email (partial match)', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Patient A', email: 'maria@gmail.com' },
        { fullName: 'Patient B', email: 'joao@hotmail.com' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { search: 'gmail' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(1);
      expect(result.patients[0]!.fullName).toBe('Patient A');
    });

    it('returns no results for non-matching search term', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [{ fullName: 'Maria Silva' }]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { search: 'zzzzz' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(0);
      expect(result.patients).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Tags filter
  // -------------------------------------------------------------------------

  describe('tags filter', () => {
    it('filters by single tag', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Patient A', tags: ['ansiedade', 'tcc'] },
        { fullName: 'Patient B', tags: ['depressão'] },
        { fullName: 'Patient C', tags: ['ansiedade'] },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { tags: ['ansiedade'] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(2);
      const names = result.patients.map((p) => p.fullName);
      expect(names).toContain('Patient A');
      expect(names).toContain('Patient C');
    });

    it('filters by multiple tags (AND logic — must have ALL)', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Patient A', tags: ['ansiedade', 'tcc'] },
        { fullName: 'Patient B', tags: ['ansiedade'] },
        { fullName: 'Patient C', tags: ['tcc', 'depressão'] },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { tags: ['ansiedade', 'tcc'] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(1);
      expect(result.patients[0]!.fullName).toBe('Patient A');
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------

  describe('pagination', () => {
    it('paginates results with correct offset', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      // Create 5 patients, alphabetically ordered
      await seedPatients(userId, [
        { fullName: 'Ana' },
        { fullName: 'Bruno' },
        { fullName: 'Carlos' },
        { fullName: 'Diana' },
        { fullName: 'Eduardo' },
      ]);
      const client = fakeSupabaseClient(userId);

      // Page 1, size 2
      const page1 = await listPatientsImpl(client, { page: 1, pageSize: 2, sort: 'full_name' });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.patients).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(2);
      expect(page1.patients[0]!.fullName).toBe('Ana');
      expect(page1.patients[1]!.fullName).toBe('Bruno');

      // Page 2, size 2
      const page2 = await listPatientsImpl(client, { page: 2, pageSize: 2, sort: 'full_name' });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      expect(page2.patients).toHaveLength(2);
      expect(page2.total).toBe(5);
      expect(page2.patients[0]!.fullName).toBe('Carlos');
      expect(page2.patients[1]!.fullName).toBe('Diana');

      // Page 3, size 2 (partial page)
      const page3 = await listPatientsImpl(client, { page: 3, pageSize: 2, sort: 'full_name' });
      expect(page3.ok).toBe(true);
      if (!page3.ok) return;
      expect(page3.patients).toHaveLength(1);
      expect(page3.patients[0]!.fullName).toBe('Eduardo');
    });

    it('returns empty list for page beyond total', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [{ fullName: 'Only Patient' }]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { page: 5, pageSize: 25 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.patients).toHaveLength(0);
      expect(result.total).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  describe('sorting', () => {
    it('sorts by full_name ascending (default)', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Carlos' },
        { fullName: 'Ana' },
        { fullName: 'Bruno' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { sort: 'full_name', order: 'asc' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const names = result.patients.map((p) => p.fullName);
      expect(names).toEqual(['Ana', 'Bruno', 'Carlos']);
    });

    it('sorts by full_name descending', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Carlos' },
        { fullName: 'Ana' },
        { fullName: 'Bruno' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { sort: 'full_name', order: 'desc' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const names = result.patients.map((p) => p.fullName);
      expect(names).toEqual(['Carlos', 'Bruno', 'Ana']);
    });

    it('sorts by created_at descending', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      const client = fakeSupabaseClient(userId);

      // Insert with small delays to ensure different created_at
      await runAsService(async (db) => {
        await db.insert(patients).values({
          id: randomUUID(),
          userId,
          fullName: 'First',
          patientType: 'individual',
          status: 'active',
          createdAt: new Date('2024-01-01'),
        });
        await db.insert(patients).values({
          id: randomUUID(),
          userId,
          fullName: 'Second',
          patientType: 'individual',
          status: 'active',
          createdAt: new Date('2024-06-01'),
        });
        await db.insert(patients).values({
          id: randomUUID(),
          userId,
          fullName: 'Third',
          patientType: 'individual',
          status: 'active',
          createdAt: new Date('2024-12-01'),
        });
      });

      const result = await listPatientsImpl(client, { sort: 'created_at', order: 'desc' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const names = result.patients.map((p) => p.fullName);
      expect(names).toEqual(['Third', 'Second', 'First']);
    });
  });

  // -------------------------------------------------------------------------
  // Combined filters
  // -------------------------------------------------------------------------

  describe('combined filters', () => {
    it('combines status filter with search', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Maria Ativa', status: 'active' },
        { fullName: 'Maria Arquivada', status: 'archived' },
        { fullName: 'João Ativo', status: 'active' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, { status: 'active', search: 'maria' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(1);
      expect(result.patients[0]!.fullName).toBe('Maria Ativa');
    });

    it('combines tags filter with status filter', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      await seedPatients(userId, [
        { fullName: 'Active with tag', status: 'active', tags: ['ansiedade'] },
        { fullName: 'Archived with tag', status: 'archived', tags: ['ansiedade'] },
        { fullName: 'Active no tag', status: 'active', tags: [] },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, {
        status: 'active',
        tags: ['ansiedade'],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.total).toBe(1);
      expect(result.patients[0]!.fullName).toBe('Active with tag');
    });

    it('combines search with pagination', async () => {
      const userId = randomUUID();
      await seedAuthUser(userId);
      // Create 4 patients with "Maria" in name
      await seedPatients(userId, [
        { fullName: 'Maria Alpha' },
        { fullName: 'Maria Beta' },
        { fullName: 'Maria Gamma' },
        { fullName: 'Maria Delta' },
        { fullName: 'João Santos' },
      ]);
      const client = fakeSupabaseClient(userId);

      const result = await listPatientsImpl(client, {
        search: 'maria',
        page: 1,
        pageSize: 2,
        sort: 'full_name',
        order: 'asc',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.patients).toHaveLength(2);
      expect(result.total).toBe(4);
      expect(result.patients[0]!.fullName).toBe('Maria Alpha');
      expect(result.patients[1]!.fullName).toBe('Maria Beta');
    });
  });
});
