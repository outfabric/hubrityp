/**
 * Inngest function: generate a CFP-compliant PDF for a finalized clinical
 * document, upload it to Supabase Storage, and update the document row.
 *
 * Triggered by the `documents/pdf.requested` event, emitted when a document
 * is finalized (see `finalizeDocumentImpl`).
 *
 * **Idempotency:** Step 1 checks whether `pdf_storage_path` is already set.
 * If so, the function returns early without re-uploading — safe for Inngest
 * retries and duplicate event delivery.
 *
 * **Service-role justification:** This runs as a background job with no user
 * session. The Drizzle `db` client connects as the DB owner (bypasses RLS)
 * and the Supabase admin client uses the service-role key to upload files to
 * Storage. Both are necessary because:
 *   1. There is no user cookie to carry.
 *   2. Finalized documents have an RLS UPDATE policy that blocks changes
 *      (status = 'draft' guard), so the service-role is required to set
 *      pdf_storage_path on an already-finalized row.
 *   3. The Storage bucket may have restrictive policies; service-role
 *      bypasses them for programmatic uploads.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { buildClinicalDocumentPdf } from '@/modules/medical-records/lib/pdf/build-clinical-document-pdf';
import type { DocumentType } from '@/modules/medical-records/lib/schemas/clinical-documents';
import { auditLog, clinicalDocuments } from '@/shared/db/schema/medical-records/tables';

import { inngest, MEDICAL_RECORDS_EVENTS, type PdfRequestedEventData } from './client';

// ---------------------------------------------------------------------------
// Types (internal)
// ---------------------------------------------------------------------------

/** Minimal DB interface for testability — any Drizzle Postgres client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

/** Row shape returned by the read-document step. */
export interface DocumentRow {
  id: string;
  userId: string;
  patientId: string;
  documentType: string;
  title: string;
  content: unknown;
  pdfStoragePath: string | null;
}

// ---------------------------------------------------------------------------
// Deps interface (for testing — dependency injection)
// ---------------------------------------------------------------------------

export interface GenerateDocumentPdfDeps {
  db: DrizzleDb;
  /** Supabase client with service-role key for Storage operations. */
  storageClient: SupabaseClient;
}

// ---------------------------------------------------------------------------
// Core logic (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Reads the document row and returns null if it does not exist or already
 * has a PDF generated (idempotency guard).
 */
export async function readDocument(
  deps: Pick<GenerateDocumentPdfDeps, 'db'>,
  documentId: string,
): Promise<DocumentRow | null> {
  const { db } = deps;

  const [row] = await db
    .select({
      id: clinicalDocuments.id,
      userId: clinicalDocuments.userId,
      patientId: clinicalDocuments.patientId,
      documentType: clinicalDocuments.documentType,
      title: clinicalDocuments.title,
      content: clinicalDocuments.content,
      pdfStoragePath: clinicalDocuments.pdfStoragePath,
    })
    .from(clinicalDocuments)
    .where(eq(clinicalDocuments.id, documentId))
    .limit(1);

  if (!row) return null;
  if (row.pdfStoragePath) return null;

  return row;
}

/**
 * Uploads a PDF buffer to Supabase Storage under the `clinical-documents`
 * bucket with the path convention `${userId}/${patientId}/${documentId}.pdf`.
 */
export async function uploadPdfToStorage(
  deps: Pick<GenerateDocumentPdfDeps, 'storageClient'>,
  path: string,
  pdfBuffer: Buffer,
): Promise<void> {
  const { storageClient } = deps;

  // service-role — bypasses Storage RLS (no user session in background jobs)
  const { error } = await storageClient.storage.from('clinical-documents').upload(path, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: false,
  });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }
}

/**
 * Updates the clinical_documents row with the storage path and PDF size.
 */
export async function updateDocumentRow(
  deps: Pick<GenerateDocumentPdfDeps, 'db'>,
  documentId: string,
  storagePath: string,
  pdfSize: number,
): Promise<void> {
  const { db } = deps;

  // service-role — bypasses RLS (finalized docs have UPDATE policy requiring
  // status='draft', but pdf_storage_path must be set after finalization)
  await db
    .update(clinicalDocuments)
    .set({
      pdfStoragePath: storagePath,
      pdfSize,
      updatedAt: new Date(),
    })
    .where(eq(clinicalDocuments.id, documentId));
}

/**
 * Writes an audit_log entry recording the PDF generation event.
 */
export async function writeAuditLog(
  deps: Pick<GenerateDocumentPdfDeps, 'db'>,
  params: {
    userId: string;
    patientId: string;
    documentId: string;
    storagePath: string;
    pdfSize: number;
  },
): Promise<void> {
  const { db } = deps;

  // service-role — audit_log has no authenticated INSERT policy by design
  await db.insert(auditLog).values({
    userId: params.userId,
    action: 'document.pdf-generated',
    resourceType: 'clinical_document',
    resourceId: params.documentId,
    metadata: {
      storagePath: params.storagePath,
      pdfSize: params.pdfSize,
      patientId: params.patientId,
    },
  });
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const generateDocumentPdf = inngest.createFunction(
  {
    id: 'documents/generate-pdf',
    triggers: [{ event: MEDICAL_RECORDS_EVENTS.PDF_REQUESTED }],
  },
  async ({ event, step, logger }) => {
    const data = event.data as PdfRequestedEventData;
    const { documentId } = data;

    // Step 1: read-document — idempotent guard
    const document: DocumentRow | null = await step.run(
      'read-document',
      async (): Promise<DocumentRow | null> => {
        // Lazy import to avoid module-level side effects in tests
        const { db } = await import('@/shared/db/client');
        return readDocument({ db }, documentId);
      },
    );

    if (!document) {
      (logger as { info: (obj: Record<string, unknown>, msg: string) => void }).info(
        { event: 'document_pdf_skipped', documentId },
        'Skipped PDF generation — document not found or already generated',
      );
      return { skipped: true, reason: 'not_found_or_already_generated' };
    }

    // Step 2: build-pdf — pure, no side effects
    const pdfBase64: string = await step.run('build-pdf', async (): Promise<string> => {
      const content = document.content as Record<string, unknown>;
      const psychologistInfo = (content.psychologistInfo as {
        name: string;
        crp: string;
        contact: string;
      }) ?? { name: '', crp: '', contact: '' };

      const buffer = await buildClinicalDocumentPdf({
        documentType: document.documentType as DocumentType,
        title: document.title,
        content,
        psychologistInfo,
      });

      // Inngest step serialization requires JSON-safe return values.
      // Convert Buffer to base64 string for cross-step transport.
      return buffer.toString('base64');
    });

    // Step 3: upload-to-storage
    const storagePath = `${document.userId}/${document.patientId}/${documentId}.pdf`;
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    await step.run('upload-to-storage', async (): Promise<void> => {
      const { createClient } = await import('@supabase/supabase-js');
      const { serverEnv } = await import('@/shared/env');
      const { clientEnv } = await import('@/shared/env/client');

      // service-role Supabase client — bypasses Storage policies.
      // Justified: background job with no user session; bucket may have
      // restrictive policies; we need programmatic upload.
      const storageClient = createClient(
        clientEnv.NEXT_PUBLIC_SUPABASE_URL,
        serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      );

      await uploadPdfToStorage({ storageClient }, storagePath, pdfBuffer);
    });

    const pdfSize = pdfBuffer.length;

    // Step 4: update-document-row
    await step.run('update-document-row', async (): Promise<void> => {
      const { db } = await import('@/shared/db/client');
      await updateDocumentRow({ db }, documentId, storagePath, pdfSize);
    });

    // Step 5: write-audit-log
    await step.run('write-audit-log', async (): Promise<void> => {
      const { db } = await import('@/shared/db/client');
      await writeAuditLog(
        { db },
        {
          userId: document.userId,
          patientId: document.patientId,
          documentId,
          storagePath,
          pdfSize,
        },
      );
    });

    (logger as { info: (obj: Record<string, unknown>, msg: string) => void }).info(
      { event: 'document_pdf_generated', documentId, pdfSize },
      `PDF generated and uploaded for document ${documentId}`,
    );

    return { success: true, path: storagePath, size: pdfSize };
  },
);
