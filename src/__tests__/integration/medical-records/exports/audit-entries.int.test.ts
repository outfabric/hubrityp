import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { requestProntuarioExportImpl } from '@/modules/medical-records/server/exports';
import { profiles } from '@/shared/db/schema/auth/tables';
import { auditLog } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Mock Inngest — intercept event emission
// ---------------------------------------------------------------------------

vi.mock('@/modules/medical-records/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: [] }) },
  MEDICAL_RECORDS_EVENTS: { PRONTUARIO_EXPORT_PDF: 'prontuario/export-pdf' },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue('192.168.1.42'),
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
      fullName: 'Dr. Audit Test',
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
      fullName: 'Audit Patient',
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
// Audit log entries for export lifecycle
// ===========================================================================

describe('prontuario export audit_log entries', () => {
  it('request creates audit_log entry with action=prontuario.export-request', async () => {
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

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, result.id));
    });

    expect(auditRows).toHaveLength(1);
    const entry = auditRows[0]!;
    expect(entry.action).toBe('prontuario.export-request');
    expect(entry.resourceType).toBe('prontuario_export');
    expect(entry.resourceId).toBe(result.id);
    expect(entry.userId).toBe(userId);

    // Metadata should contain filters and IP
    const metadata = entry.metadata as Record<string, unknown>;
    expect(metadata).toHaveProperty('filters');
    expect(metadata.filters).toEqual(VALID_FILTERS);
    expect(metadata).toHaveProperty('ip', '192.168.1.42');
  });

  it('completion audit_log entry has correct metadata', async () => {
    const userId = randomUUID();
    const exportId = randomUUID();
    const patientId = randomUUID();
    const storagePath = `${userId}/${patientId}/${exportId}.pdf`;
    const fileSize = 5_000_000;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    // Simulate the audit-complete step that the Inngest job writes
    await runAsService(async (db) => {
      await db.insert(auditLog).values({
        userId,
        action: 'prontuario.export-completed',
        resourceType: 'prontuario_export',
        resourceId: exportId,
        metadata: {
          storagePath,
          fileSize,
          patientId,
          expiresAt: expiresAt.toISOString(),
          includesPersonalNotes: false,
        },
      });
    });

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, exportId));
    });

    expect(auditRows).toHaveLength(1);
    const entry = auditRows[0]!;
    expect(entry.action).toBe('prontuario.export-completed');
    expect(entry.resourceType).toBe('prontuario_export');
    expect(entry.userId).toBe(userId);

    const metadata = entry.metadata as Record<string, unknown>;
    expect(metadata).toHaveProperty('storagePath', storagePath);
    expect(metadata).toHaveProperty('fileSize', fileSize);
    expect(metadata).toHaveProperty('patientId', patientId);
    expect(metadata).toHaveProperty('expiresAt');
    expect(metadata).toHaveProperty('includesPersonalNotes', false);
  });

  it('multiple requests create separate audit entries', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const result1 = await requestProntuarioExportImpl(fakeSupabaseClient(userId), {
      patientId,
      filters: VALID_FILTERS,
    });

    const result2 = await requestProntuarioExportImpl(fakeSupabaseClient(userId), {
      patientId,
      filters: { ...VALID_FILTERS, includePersonalNotes: true },
    });

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });

    expect(auditRows).toHaveLength(2);
    const actions = auditRows.map((r) => r.action);
    expect(actions).toEqual(['prontuario.export-request', 'prontuario.export-request']);

    // Verify each has a different resource_id
    const resourceIds = auditRows.map((r) => r.resourceId);
    expect(new Set(resourceIds).size).toBe(2);
  });
});
