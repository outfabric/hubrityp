import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import {
  readDocument,
  updateDocumentRow,
  uploadPdfToStorage,
  writeAuditLog,
} from '@/modules/medical-records/inngest/generate-document-pdf';
import { buildClinicalDocumentPdf } from '@/modules/medical-records/lib/pdf/build-clinical-document-pdf';
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

async function seedFinalizedDocument(
  userId: string,
  patientId: string,
  overrides?: Partial<{
    id: string;
    documentType: string;
    title: string;
    content: Record<string, unknown>;
    pdfStoragePath: string | null;
    pdfSize: number | null;
  }>,
): Promise<string> {
  const docId = overrides?.id ?? randomUUID();
  await runAsService(async (db) => {
    await db.insert(clinicalDocuments).values({
      id: docId,
      userId,
      patientId,
      documentType: overrides?.documentType ?? 'declaracao',
      title: overrides?.title ?? 'Test Document',
      content: overrides?.content ?? {
        solicitante: 'Empresa X',
        demanda: 'Comparecimento',
        procedimentos: 'Sessao',
        conclusao: 'Confirmado',
        localData: { local: 'Sao Paulo', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr. Test Psych', crp: '06/12345', contact: '' },
      },
      status: 'finalized',
      finalizedAt: new Date(),
      pdfStoragePath: overrides?.pdfStoragePath ?? null,
      pdfSize: overrides?.pdfSize ?? null,
    });
  });
  return docId;
}

/**
 * Creates a mock Supabase Storage client that captures upload calls.
 * Returns the mock client and a reference to the upload spy for assertions.
 */
function createMockStorageClient() {
  const uploadMock = vi.fn().mockResolvedValue({ data: { path: '' }, error: null });
  const fromMock = vi.fn().mockReturnValue({ upload: uploadMock });

  const client = {
    storage: {
      from: fromMock,
    },
  } as unknown as Parameters<typeof uploadPdfToStorage>[0]['storageClient'];

  return { client, uploadMock, fromMock };
}

afterEach(async () => {
  vi.clearAllMocks();
  await cleanTestData();
});

// ===========================================================================
// readDocument
// ===========================================================================

describe('readDocument', () => {
  it('returns the document row for a finalized document without pdf_storage_path', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedFinalizedDocument(userId, patientId);

    const result = await runAsService(async (db) => {
      return readDocument({ db }, docId);
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(docId);
    expect(result!.userId).toBe(userId);
    expect(result!.patientId).toBe(patientId);
    expect(result!.pdfStoragePath).toBeNull();
  });

  it('returns null when document does not exist', async () => {
    const result = await runAsService(async (db) => {
      return readDocument({ db }, randomUUID());
    });

    expect(result).toBeNull();
  });

  it('returns null when pdf_storage_path is already set (idempotency)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedFinalizedDocument(userId, patientId, {
      pdfStoragePath: `${userId}/${patientId}/existing.pdf`,
      pdfSize: 1024,
    });

    const result = await runAsService(async (db) => {
      return readDocument({ db }, docId);
    });

    expect(result).toBeNull();
  });
});

// ===========================================================================
// buildClinicalDocumentPdf (non-empty buffer)
// ===========================================================================

describe('buildClinicalDocumentPdf (integration)', () => {
  it('produces a non-empty PDF buffer from typical document content', async () => {
    const buffer = await buildClinicalDocumentPdf({
      documentType: 'declaracao',
      title: 'Declaracao de Comparecimento',
      content: {
        solicitante: 'Empresa X',
        demanda: 'Comparecimento em sessao',
        procedimentos: 'Sessao individual',
        conclusao: 'Compareceu na data indicada',
        localData: { local: 'Sao Paulo', data: '2024-06-15' },
      },
      psychologistInfo: {
        name: 'Dr. Test Psych',
        crp: '06/12345',
        contact: '',
      },
    });

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // PDF magic bytes: %PDF-
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

// ===========================================================================
// uploadPdfToStorage
// ===========================================================================

describe('uploadPdfToStorage', () => {
  it('uploads to the clinical-documents bucket with the correct path', async () => {
    const { client, uploadMock, fromMock } = createMockStorageClient();
    const path = `user-123/patient-456/doc-789.pdf`;
    const pdfBuffer = Buffer.from('%PDF-1.4 test content');

    await uploadPdfToStorage({ storageClient: client }, path, pdfBuffer);

    expect(fromMock).toHaveBeenCalledWith('clinical-documents');
    expect(uploadMock).toHaveBeenCalledWith(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });
  });

  it('throws when storage upload returns an error', async () => {
    const uploadMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Bucket not found' },
    });

    const client = {
      storage: {
        from: vi.fn().mockReturnValue({ upload: uploadMock }),
      },
    } as unknown as Parameters<typeof uploadPdfToStorage>[0]['storageClient'];

    await expect(
      uploadPdfToStorage({ storageClient: client }, 'test/path.pdf', Buffer.from('test')),
    ).rejects.toThrow('Storage upload failed: Bucket not found');
  });
});

// ===========================================================================
// updateDocumentRow
// ===========================================================================

describe('updateDocumentRow', () => {
  it('sets pdf_storage_path and pdf_size on the document', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedFinalizedDocument(userId, patientId);
    const storagePath = `${userId}/${patientId}/${docId}.pdf`;
    const pdfSize = 4096;

    await runAsService(async (db) => {
      await updateDocumentRow({ db }, docId, storagePath, pdfSize);
    });

    // Verify the row was updated
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.pdfStoragePath).toBe(storagePath);
    expect(rows[0]!.pdfSize).toBe(pdfSize);
  });
});

// ===========================================================================
// writeAuditLog
// ===========================================================================

describe('writeAuditLog', () => {
  it('writes a document.pdf-generated audit_log entry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const docId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    // Need the document to exist for FK constraints (resource_id is a UUID but
    // audit_log does not have a FK on resource_id — only on user_id via auth.users)
    await seedFinalizedDocument(userId, patientId, { id: docId });

    const storagePath = `${userId}/${patientId}/${docId}.pdf`;
    const pdfSize = 2048;

    await runAsService(async (db) => {
      await writeAuditLog({ db }, { userId, patientId, documentId: docId, storagePath, pdfSize });
    });

    // Verify the audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, docId));
    });

    const pdfLog = logs.find((l) => l.action === 'document.pdf-generated');
    expect(pdfLog).toBeDefined();
    expect(pdfLog!.userId).toBe(userId);
    expect(pdfLog!.resourceType).toBe('clinical_document');

    const metadata = pdfLog!.metadata as Record<string, unknown>;
    expect(metadata.storagePath).toBe(storagePath);
    expect(metadata.pdfSize).toBe(pdfSize);
    expect(metadata.patientId).toBe(patientId);
  });
});

// ===========================================================================
// Full pipeline (orchestrated through exported helpers)
// ===========================================================================

describe('generate-document-pdf full pipeline', () => {
  it('reads document, builds PDF, uploads to Storage, updates row, writes audit log', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedFinalizedDocument(userId, patientId, {
      content: {
        solicitante: 'Empresa ABC',
        demanda: 'Comparecimento',
        procedimentos: 'Sessao individual',
        conclusao: 'Compareceu na data indicada',
        localData: { local: 'Sao Paulo', data: '2024-06-15' },
        psychologistInfo: { name: 'Dr. Test Psych', crp: '06/12345', contact: '' },
      },
    });

    // Step 1: Read document
    const document = await runAsService(async (db) => {
      return readDocument({ db }, docId);
    });

    expect(document).not.toBeNull();
    expect(document!.id).toBe(docId);

    // Step 2: Build PDF
    const content = document!.content as Record<string, unknown>;
    const psychologistInfo = (content.psychologistInfo as {
      name: string;
      crp: string;
      contact: string;
    }) ?? { name: '', crp: '', contact: '' };

    const pdfBuffer = await buildClinicalDocumentPdf({
      documentType: document!.documentType as 'declaracao',
      title: document!.title,
      content,
      psychologistInfo,
    });

    expect(pdfBuffer.length).toBeGreaterThan(0);

    // Step 3: Upload to Storage (mocked)
    const { client: mockStorageClient, uploadMock, fromMock } = createMockStorageClient();
    const storagePath = `${document!.userId}/${document!.patientId}/${docId}.pdf`;

    await uploadPdfToStorage({ storageClient: mockStorageClient }, storagePath, pdfBuffer);

    expect(fromMock).toHaveBeenCalledWith('clinical-documents');
    expect(uploadMock).toHaveBeenCalledWith(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

    // Step 4: Update document row
    await runAsService(async (db) => {
      await updateDocumentRow({ db }, docId, storagePath, pdfBuffer.length);
    });

    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows[0]!.pdfStoragePath).toBe(storagePath);
    expect(rows[0]!.pdfSize).toBeGreaterThan(0);
    expect(rows[0]!.pdfSize).toBe(pdfBuffer.length);

    // Step 5: Write audit log
    await runAsService(async (db) => {
      await writeAuditLog(
        { db },
        {
          userId: document!.userId,
          patientId: document!.patientId,
          documentId: docId,
          storagePath,
          pdfSize: pdfBuffer.length,
        },
      );
    });

    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, docId));
    });

    const pdfLog = logs.find((l) => l.action === 'document.pdf-generated');
    expect(pdfLog).toBeDefined();
    expect(pdfLog!.userId).toBe(userId);
    expect(pdfLog!.resourceType).toBe('clinical_document');
  });

  it('idempotent: second run with pdf_storage_path already set returns null without re-upload', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const existingPath = `${userId}/${patientId}/already-generated.pdf`;
    const docId = await seedFinalizedDocument(userId, patientId, {
      pdfStoragePath: existingPath,
      pdfSize: 1024,
    });

    // readDocument should return null for an already-generated document
    const document = await runAsService(async (db) => {
      return readDocument({ db }, docId);
    });

    expect(document).toBeNull();

    // Verify pdf_storage_path was not changed
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows[0]!.pdfStoragePath).toBe(existingPath);
    expect(rows[0]!.pdfSize).toBe(1024);
  });
});
