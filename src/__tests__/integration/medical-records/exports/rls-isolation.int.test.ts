import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { runAsUser } from '@/__tests__/integration/setup/run-as-user';
import { getExportSignedUrlImpl } from '@/modules/medical-records/server/exports';
import { profiles } from '@/shared/db/schema/auth/tables';
import { prontuarioExports } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

// Mock Inngest — not needed for RLS tests but required by the exports module
vi.mock('@/modules/medical-records/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: [] }) },
  MEDICAL_RECORDS_EVENTS: { PRONTUARIO_EXPORT_PDF: 'prontuario/export-pdf' },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue('127.0.0.1'),
  }),
}));

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

async function seedProfile(userId: string): Promise<void> {
  const crpSerial = userId.replace(/-/g, '').slice(0, 7);
  await runAsService(async (db) => {
    await db.insert(profiles).values({
      userId,
      email: `test-${userId}@example.com`,
      fullName: 'Dr. Test RLS',
      crpNumber: `06/${crpSerial}`,
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
  });
}

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'RLS Test Patient',
    });
  });
}

async function seedExport(
  userId: string,
  patientId: string,
  exportId: string,
  overrides: Partial<{ status: string; storagePath: string | null; expiresAt: Date | null }> = {},
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(prontuarioExports).values({
      id: exportId,
      userId,
      patientId,
      status: overrides.status ?? 'ready',
      filters: {
        dateRange: { from: null, to: null },
        sections: {
          anamnese: true,
          evolucoes: true,
          hipoteses: true,
          planoTerapeutico: true,
          escalas: true,
          documentos: true,
          anexosIndex: true,
        },
        includePersonalNotes: false,
      },
      storagePath: overrides.storagePath ?? `${userId}/${patientId}/${exportId}.pdf`,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  });
}

function fakeSupabaseClient(userId: string | null) {
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    storage: {
      from: () => ({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://storage.example.com/signed' },
          error: null,
        }),
      }),
    },
  } as unknown as Parameters<typeof getExportSignedUrlImpl>[0];
}

afterEach(async () => {
  await cleanTestData();
});

// ===========================================================================
// RLS isolation for prontuario_exports
// ===========================================================================

describe('prontuario_exports RLS — cross-user isolation', () => {
  it('psychologist B cannot SELECT psychologist A exports via RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();
    const exportA = randomUUID();
    const exportB = randomUUID();

    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientA);
    await seedPatient(userB, patientB);
    await seedExport(userA, patientA, exportA);
    await seedExport(userB, patientB, exportB);

    // User B's RLS-scoped client should only see their own export
    const visibleToB = await runAsUser(userB, async (db) => {
      return db.select().from(prontuarioExports);
    });

    expect(visibleToB).toHaveLength(1);
    expect(visibleToB[0]!.id).toBe(exportB);
    expect(visibleToB[0]!.userId).toBe(userB);

    // Positive control: User A can see their own export
    const visibleToA = await runAsUser(userA, async (db) => {
      return db.select().from(prontuarioExports);
    });

    expect(visibleToA).toHaveLength(1);
    expect(visibleToA[0]!.id).toBe(exportA);
    expect(visibleToA[0]!.userId).toBe(userA);
  });

  it('psychologist B cannot INSERT export with user_id = userA (RLS WITH CHECK)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();

    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientA);

    // User B tries to INSERT a row claiming to be user A — RLS should reject
    await expect(
      runAsUser(userB, async (db) => {
        await db.insert(prontuarioExports).values({
          userId: userA, // Spoofed user_id
          patientId: patientA,
          status: 'pending',
          filters: {
            dateRange: { from: null, to: null },
            sections: {},
            includePersonalNotes: false,
          },
        });
      }),
    ).rejects.toThrow();

    // Verify no row was created
    const allRows = await runAsService(async (db) => {
      return db.select().from(prontuarioExports);
    });
    expect(allRows).toHaveLength(0);
  });

  it('no authenticated user can UPDATE prontuario_exports (no UPDATE policy)', async () => {
    const userA = randomUUID();
    const patientA = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userA);
    await seedProfile(userA);
    await seedPatient(userA, patientA);
    await seedExport(userA, patientA, exportId, { status: 'pending' });

    // Owner tries to UPDATE status — no UPDATE policy means zero rows affected
    await runAsUser(userA, async (db) => {
      await db.execute(dsql`UPDATE prontuario_exports SET status = 'ready' WHERE id = ${exportId}`);
    });

    // Verify status is unchanged (RLS blocked the update)
    const rows = await runAsService(async (db) => {
      return db.select().from(prontuarioExports);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
  });

  it('no authenticated user can DELETE from prontuario_exports (no DELETE policy)', async () => {
    const userA = randomUUID();
    const patientA = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userA);
    await seedProfile(userA);
    await seedPatient(userA, patientA);
    await seedExport(userA, patientA, exportId);

    // Owner tries to DELETE — RLS without DELETE policy silently filters to 0 rows
    await runAsUser(userA, async (db) => {
      await db.execute(dsql`DELETE FROM prontuario_exports WHERE id = ${exportId}`);
    });

    // Verify row still exists
    const rows = await runAsService(async (db) => {
      return db.select().from(prontuarioExports);
    });
    expect(rows).toHaveLength(1);
  });

  it('getExportSignedUrlImpl returns NOT_FOUND for another user export (action-level)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientA = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientA);
    await seedExport(userA, patientA, exportId);

    // User B tries to get signed URL for user A's export — defense-in-depth
    const result = await getExportSignedUrlImpl(fakeSupabaseClient(userB), {
      exportId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});
