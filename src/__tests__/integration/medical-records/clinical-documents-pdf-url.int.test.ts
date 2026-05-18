import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { getDocumentPdfUrlImpl } from '@/modules/medical-records/server/clinical-documents';
import { profiles } from '@/shared/db/schema/auth/tables';
import { auditLog, clinicalDocuments } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

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
      fullName: 'Dr. Test Psych',
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
      fullName: 'Test Patient',
    });
  });
}

async function seedDocument(
  userId: string,
  patientId: string,
  overrides?: Partial<{
    id: string;
    pdfStoragePath: string | null;
    status: string;
    finalizedAt: Date | null;
  }>,
): Promise<string> {
  const docId = overrides?.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(clinicalDocuments).values({
      id: docId,
      userId,
      patientId,
      documentType: 'declaracao',
      title: 'Test Document',
      content: { body: 'test content' },
      status: overrides?.status ?? 'finalized',
      finalizedAt: overrides?.finalizedAt ?? new Date(),
      pdfStoragePath: overrides?.pdfStoragePath ?? null,
    });
  });
  return docId;
}

/**
 * Builds a fake Supabase client with stubbed auth AND storage.
 *
 * The real DB (via Drizzle) handles ownership queries. Storage's
 * `createSignedUrl` is mocked because integration tests do not spin
 * up a real Storage bucket.
 */
function fakeSupabaseClientWithStorage(
  userId: string | null,
  signedUrlResponse?: {
    data: { signedUrl: string } | null;
    error: { message: string } | null;
  },
) {
  const defaultResponse = {
    data: { signedUrl: 'https://mock-storage.example.com/signed/test.pdf' },
    error: null,
  };

  // Cast through `unknown` — the fake only stubs the subset of SupabaseClient
  // that `getDocumentPdfUrlImpl` uses (auth + storage).
  return {
    auth: {
      // eslint-disable-next-line @typescript-eslint/require-await -- fake implementation returns a static value
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue(signedUrlResponse ?? defaultResponse),
      }),
    },
  } as unknown as Parameters<typeof getDocumentPdfUrlImpl>[0];
}

afterEach(async () => {
  await cleanTestData();
});

// ===========================================================================
// getDocumentPdfUrlImpl
// ===========================================================================

describe('getDocumentPdfUrlImpl', () => {
  it('returns signed URL when pdf_storage_path is set', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const pdfPath = `${userId}/${patientId}/doc123.pdf`;
    const docId = await seedDocument(userId, patientId, {
      pdfStoragePath: pdfPath,
      status: 'finalized',
      finalizedAt: new Date(),
    });

    const mockClient = fakeSupabaseClientWithStorage(userId);
    const result = await getDocumentPdfUrlImpl(mockClient, { documentId: docId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.signedUrl).toBe('https://mock-storage.example.com/signed/test.pdf');
    expect(result.data.expiresIn).toBe(300);

    // Verify storage was called with the correct bucket and path.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock is safe to reference unbound
    expect(mockClient.storage.from).toHaveBeenCalledWith('clinical-documents');
  });

  it('returns PDF_NOT_READY when pdf_storage_path is null', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDocument(userId, patientId, {
      pdfStoragePath: null,
      status: 'finalized',
      finalizedAt: new Date(),
    });

    const result = await getDocumentPdfUrlImpl(fakeSupabaseClientWithStorage(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PDF_NOT_READY');
  });

  it('returns NOT_FOUND when document belongs to another user (cross-tenant)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientId);

    const docId = await seedDocument(userA, patientId, {
      pdfStoragePath: `${userA}/${patientId}/doc.pdf`,
    });

    // userB tries to get PDF URL for userA's document
    const result = await getDocumentPdfUrlImpl(fakeSupabaseClientWithStorage(userB), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await getDocumentPdfUrlImpl(fakeSupabaseClientWithStorage(null), {
      documentId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns NOT_FOUND for non-existent document', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);

    const result = await getDocumentPdfUrlImpl(fakeSupabaseClientWithStorage(userId), {
      documentId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND for invalid (non-UUID) documentId', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await getDocumentPdfUrlImpl(fakeSupabaseClientWithStorage(userId), {
      documentId: 'not-a-uuid',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns STORAGE_ERROR when Supabase Storage fails', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDocument(userId, patientId, {
      pdfStoragePath: `${userId}/${patientId}/doc.pdf`,
    });

    const failingClient = fakeSupabaseClientWithStorage(userId, {
      data: null,
      error: { message: 'Object not found' },
    });

    const result = await getDocumentPdfUrlImpl(failingClient, { documentId: docId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('STORAGE_ERROR');
  });

  it('writes audit_log entry on successful PDF URL generation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDocument(userId, patientId, {
      pdfStoragePath: `${userId}/${patientId}/doc.pdf`,
    });

    const result = await getDocumentPdfUrlImpl(fakeSupabaseClientWithStorage(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(true);

    // Verify audit_log entry was written
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, docId));
    });

    const downloadLog = logs.find((l) => l.action === 'document.pdf-download');
    expect(downloadLog).toBeDefined();
    expect(downloadLog!.resourceType).toBe('clinical_document');
    expect(downloadLog!.userId).toBe(userId);
  });
});
