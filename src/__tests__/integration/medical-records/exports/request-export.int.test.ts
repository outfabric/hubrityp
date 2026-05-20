import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { requestProntuarioExportImpl } from '@/modules/medical-records/server/exports';
import { profiles } from '@/shared/db/schema/auth/tables';
import { auditLog, prontuarioExports } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Mock Inngest — intercept event emission without hitting real infra
// ---------------------------------------------------------------------------

// vi.hoisted runs BEFORE vi.mock hoisting, so the spy is available in the factory
const { inngestSendSpy } = vi.hoisted(() => ({
  inngestSendSpy: vi.fn().mockResolvedValue({ ids: [] }),
}));

vi.mock('@/modules/medical-records/inngest/client', () => ({
  inngest: { send: inngestSendSpy },
  MEDICAL_RECORDS_EVENTS: { PRONTUARIO_EXPORT_PDF: 'prontuario/export-pdf' },
}));

// Mock next/headers to avoid SSR-only errors in test
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
      fullName: 'Dr. Test Export',
      crpNumber: `06/${crpSerial}`,
      crpUf: 'SP',
      status: 'active',
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      sensitiveDataConsentAt: new Date(),
    });
  });
}

async function seedPatient(
  userId: string,
  patientId: string,
  fullName = 'Test Patient',
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName,
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
  } as Parameters<typeof requestProntuarioExportImpl>[0];
}

const VALID_FILTERS = {
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
};

afterEach(async () => {
  vi.clearAllMocks();
  await cleanTestData();
});

// ===========================================================================
// requestProntuarioExportImpl
// ===========================================================================

describe('requestProntuarioExportImpl', () => {
  it('creates export row + audit_log + emits Inngest event', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const result = await requestProntuarioExportImpl(fakeSupabaseClient(userId), {
      patientId,
      filters: VALID_FILTERS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify export row
    const exportRows = await runAsService(async (db) => {
      return db.select().from(prontuarioExports).where(eq(prontuarioExports.id, result.id));
    });

    expect(exportRows).toHaveLength(1);
    const exportRow = exportRows[0]!;
    expect(exportRow.status).toBe('pending');
    expect(exportRow.userId).toBe(userId);
    expect(exportRow.patientId).toBe(patientId);
    expect(exportRow.filters).toEqual(VALID_FILTERS);

    // Verify audit_log entry
    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, result.id));
    });

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.action).toBe('prontuario.export-request');
    expect(auditRows[0]!.resourceType).toBe('prontuario_export');
    expect(auditRows[0]!.userId).toBe(userId);
    expect(auditRows[0]!.metadata).toEqual(expect.objectContaining({ filters: VALID_FILTERS }));

    // Verify Inngest event emitted
    expect(inngestSendSpy).toHaveBeenCalledOnce();
    expect(inngestSendSpy).toHaveBeenCalledWith({
      name: 'prontuario/export-pdf',
      data: { exportId: result.id },
    });
  });

  it('rejects export for another user patient — NOT_FOUND, no side effects', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientId);

    // userB tries to export userA's patient
    const result = await requestProntuarioExportImpl(fakeSupabaseClient(userB), {
      patientId,
      filters: VALID_FILTERS,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });

    // No export row created
    const exportRows = await runAsService(async (db) => {
      return db.select().from(prontuarioExports);
    });
    expect(exportRows).toHaveLength(0);

    // No audit entry created
    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog);
    });
    expect(auditRows).toHaveLength(0);

    // No Inngest event emitted
    expect(inngestSendSpy).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated call — UNAUTHORIZED, no side effects', async () => {
    const patientId = randomUUID();

    const result = await requestProntuarioExportImpl(fakeSupabaseClient(null), {
      patientId,
      filters: VALID_FILTERS,
    });

    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });

    // No export row created
    const exportRows = await runAsService(async (db) => {
      return db.select().from(prontuarioExports);
    });
    expect(exportRows).toHaveLength(0);

    // No Inngest event emitted
    expect(inngestSendSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid input — VALIDATION_ERROR', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);

    const result = await requestProntuarioExportImpl(fakeSupabaseClient(userId), {
      patientId: 'not-a-uuid',
      filters: VALID_FILTERS,
    });

    expect(result).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
  });
});
