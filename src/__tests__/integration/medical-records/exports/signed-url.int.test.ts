import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { getExportSignedUrlImpl } from '@/modules/medical-records/server/exports';
import { profiles } from '@/shared/db/schema/auth/tables';
import { prontuarioExports } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

// Module mocks required by transitive imports
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
      fullName: 'Dr. SignedUrl Test',
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
      fullName: 'SignedUrl Patient',
    });
  });
}

async function seedExport(
  userId: string,
  patientId: string,
  exportId: string,
  overrides: Partial<{
    status: string;
    storagePath: string | null;
    expiresAt: Date | null;
    completedAt: Date | null;
  }> = {},
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
      storagePath:
        overrides.storagePath !== undefined
          ? overrides.storagePath
          : `${userId}/${patientId}/${exportId}.pdf`,
      expiresAt:
        overrides.expiresAt !== undefined
          ? overrides.expiresAt
          : new Date(Date.now() + 24 * 60 * 60 * 1000),
      completedAt: overrides.completedAt !== undefined ? overrides.completedAt : new Date(),
    });
  });
}

// The Storage mock captures the `expiresIn` param to verify correct clamping
let lastCreateSignedUrlExpiresIn: number | undefined;

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
        createSignedUrl: vi.fn().mockImplementation((_path: string, expiresIn: number) => {
          lastCreateSignedUrlExpiresIn = expiresIn;
          return Promise.resolve({
            data: { signedUrl: 'https://storage.example.com/signed-url' },
            error: null,
          });
        }),
      }),
    },
  } as unknown as Parameters<typeof getExportSignedUrlImpl>[0];
}

afterEach(async () => {
  vi.clearAllMocks();
  lastCreateSignedUrlExpiresIn = undefined;
  await cleanTestData();
});

// ===========================================================================
// getExportSignedUrlImpl
// ===========================================================================

describe('getExportSignedUrlImpl', () => {
  it('returns NOT_READY for status=processing', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedExport(userId, patientId, exportId, { status: 'processing' });

    const result = await getExportSignedUrlImpl(fakeSupabaseClient(userId), {
      exportId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_READY');
  });

  it('returns EXPIRED for status=ready with expires_at in the past', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedExport(userId, patientId, exportId, {
      status: 'ready',
      expiresAt: new Date(Date.now() - 60_000), // 1 minute ago
    });

    const result = await getExportSignedUrlImpl(fakeSupabaseClient(userId), {
      exportId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EXPIRED');
  });

  it('returns signed URL for status=ready with future expires_at', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const exportId = randomUUID();
    const futureExpiry = new Date(Date.now() + 3600_000); // 1 hour from now

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedExport(userId, patientId, exportId, {
      status: 'ready',
      expiresAt: futureExpiry,
    });

    const result = await getExportSignedUrlImpl(fakeSupabaseClient(userId), {
      exportId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signedUrl).toBe('https://storage.example.com/signed-url');
    expect(result.fileName).toMatch(/^prontuario-SignedUrl-\d{4}-\d{2}-\d{2}\.pdf$/);

    // Verify Storage was called with correct expiresIn clamped to row's expires_at
    expect(lastCreateSignedUrlExpiresIn).toBeDefined();
    expect(lastCreateSignedUrlExpiresIn!).toBeGreaterThan(0);
    // The expiresIn should be approximately (futureExpiry - now) in seconds
    expect(lastCreateSignedUrlExpiresIn!).toBeLessThanOrEqual(3600);
  });

  it('returns NOT_FOUND for another user export', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientId);
    await seedExport(userA, patientId, exportId);

    const result = await getExportSignedUrlImpl(fakeSupabaseClient(userB), {
      exportId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED for unauthenticated caller', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedExport(userId, patientId, exportId);

    const result = await getExportSignedUrlImpl(fakeSupabaseClient(null), {
      exportId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns NOT_READY when storage_path is null', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const exportId = randomUUID();

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);
    await seedExport(userId, patientId, exportId, {
      status: 'ready',
      storagePath: null,
    });

    const result = await getExportSignedUrlImpl(fakeSupabaseClient(userId), {
      exportId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_READY');
  });
});
