import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { inngest } from '@/modules/medical-records/inngest/client';
import {
  computeReferencesCid10,
  createDocumentInputSchema,
  finalizeDocumentInputSchema,
  updateDocumentInputSchema,
} from '@/modules/medical-records/lib/schemas/clinical-documents';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { auditLog, clinicalDocuments } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CreateDocumentResult =
  | { ok: true; id: string }
  | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'VALIDATION_ERROR' };

export type UpdateDocumentResult =
  | { ok: true; id: string }
  | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'ALREADY_FINALIZED' | 'VALIDATION_ERROR' };

export type ListDocumentsByPatientResult =
  | { ok: true; documents: DocumentSummary[] }
  | { ok: false; code: 'UNAUTHORIZED' | 'VALIDATION_ERROR' };

export type GetDocumentDetailResult =
  | { ok: true; document: DocumentFull }
  | { ok: false; code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'VALIDATION_ERROR' };

export type FinalizeDocumentResult =
  | { ok: true; data: { id: string } }
  | {
      ok: false;
      code:
        | 'UNAUTHORIZED'
        | 'NOT_FOUND'
        | 'ALREADY_FINALIZED'
        | 'VALIDATION_ERROR'
        | 'CID10_CONSENT_REQUIRED';
    };

export interface DocumentSummary {
  id: string;
  patientId: string;
  documentType: string;
  title: string;
  status: string;
  referencesCid10: boolean;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentFull = typeof clinicalDocuments.$inferSelect;

// ---------------------------------------------------------------------------
// Input schemas (list/detail-specific)
// ---------------------------------------------------------------------------

const listDocumentsByPatientSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID valido.' }),
  type: z.enum(['declaracao', 'atestado', 'relatorio', 'laudo', 'parecer']).optional(),
  status: z.enum(['draft', 'finalized']).optional(),
});

const getDocumentDetailSchema = z.object({
  documentId: z.string().uuid({ message: 'documentId deve ser um UUID valido.' }),
});

// ---------------------------------------------------------------------------
// createDocument
// ---------------------------------------------------------------------------

/**
 * Creates a new clinical document for the authenticated psychologist's patient.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (createDocumentInputSchema).
 *   3. Verify patient ownership (defense-in-depth — db bypasses RLS).
 *   4. Snapshot psychologistInfo from profiles table (name, CRP, contact).
 *   5. INSERT document with user_id from session, status='draft',
 *      content merged with psychologistInfo snapshot.
 *   6. Write audit_log 'document.create'.
 *   7. Return document ID on success.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function createDocumentImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<CreateDocumentResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = createDocumentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { patientId, document_type, title, content } = parsed.data;
  const userId = user.id;

  // 3. Verify patient belongs to the authenticated user (defense-in-depth:
  // db bypasses RLS, so explicit ownership check prevents cross-tenant writes).
  // We use the patients table imported inline to avoid circular module deps.
  const { patients } = await import('@/shared/db/schema/patients/tables');
  const [patient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.userId, userId)))
    .limit(1);

  if (!patient) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. Snapshot psychologistInfo from profiles table
  const [profile] = await db
    .select({
      fullName: profiles.fullName,
      crpNumber: profiles.crpNumber,
      crpUf: profiles.crpUf,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  const psychologistInfo = profile
    ? {
        name: profile.fullName,
        crp: `${profile.crpNumber}/${profile.crpUf}`,
        contact: '',
      }
    : { name: '', crp: '', contact: '' };

  // 5. Merge content with psychologistInfo snapshot and determine CID-10 references
  const mergedContent = {
    ...(content ?? {}),
    document_type,
    psychologistInfo,
  };

  const referencesCid10 = computeReferencesCid10(mergedContent);

  try {
    const [document] = await db
      .insert(clinicalDocuments)
      .values({
        userId,
        patientId,
        documentType: document_type,
        title: title ?? '',
        content: mergedContent,
        status: 'draft',
        referencesCid10,
      })
      .returning({ id: clinicalDocuments.id });

    // 6. Write audit_log entry (fire-and-forget on failure)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'document.create',
        resourceType: 'clinical_document',
        resourceId: document!.id,
        metadata: { patientId, documentType: document_type },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'document_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for document.create',
      );
    }

    return { ok: true, id: document!.id };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'create_document_failed', errorCode: pgError.code },
      'unexpected error creating clinical document',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateDocument
// ---------------------------------------------------------------------------

/**
 * Updates a draft clinical document for the authenticated psychologist.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod (updateDocumentInputSchema).
 *   3. Query the document by ID with explicit userId filter (defense-in-depth).
 *   4. If not found → NOT_FOUND. If status='finalized' → ALREADY_FINALIZED.
 *   5. Update content, title, references_cid10 (recomputed), updated_at=now.
 *   6. Write audit_log 'document.update'.
 *   7. Return document ID on success.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function updateDocumentImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<UpdateDocumentResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = updateDocumentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { documentId, title, content } = parsed.data;
  const userId = user.id;

  // 3. Fetch the document (defense-in-depth: explicit userId filter + RLS)
  const [document] = await db
    .select({
      id: clinicalDocuments.id,
      status: clinicalDocuments.status,
    })
    .from(clinicalDocuments)
    .where(and(eq(clinicalDocuments.id, documentId), eq(clinicalDocuments.userId, userId)))
    .limit(1);

  if (!document) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. Check if already finalized
  if (document.status === 'finalized') {
    return { ok: false, code: 'ALREADY_FINALIZED' };
  }

  // 5. Build update payload
  const updateFields: Record<string, unknown> = { updatedAt: new Date() };

  if (title !== undefined) {
    updateFields.title = title;
  }

  if (content !== undefined) {
    updateFields.content = content;
    // Recompute CID-10 references from the new content
    updateFields.referencesCid10 = computeReferencesCid10(content);
  }

  try {
    await db
      .update(clinicalDocuments)
      .set(updateFields)
      .where(and(eq(clinicalDocuments.id, documentId), eq(clinicalDocuments.userId, userId)));

    // 6. Write audit_log entry (fire-and-forget on failure)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'document.update',
        resourceType: 'clinical_document',
        resourceId: documentId,
        metadata: {},
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'document_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for document.update',
      );
    }

    return { ok: true, id: documentId };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'update_document_failed', errorCode: pgError.code },
      'unexpected error updating clinical document',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listDocumentsByPatient
// ---------------------------------------------------------------------------

/**
 * Returns clinical documents for a given patient owned by the requesting
 * psychologist, ordered by created_at DESC (most recent first).
 *
 * Content is NOT included in the summary to keep payloads small — use
 * getDocumentDetail for full content.
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod.
 *   3. Query WHERE patient_id AND user_id = auth.uid() with optional filters.
 *   4. Write audit_log 'document.list' (resource_id = patientId).
 *   5. Return documents array.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function listDocumentsByPatientImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<ListDocumentsByPatientResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = listDocumentsByPatientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { patientId, type, status } = parsed.data;
  const userId = user.id;

  try {
    // 3. Build query conditions
    const conditions = [
      eq(clinicalDocuments.userId, userId),
      eq(clinicalDocuments.patientId, patientId),
    ];

    if (type) {
      conditions.push(eq(clinicalDocuments.documentType, type));
    }

    if (status) {
      conditions.push(eq(clinicalDocuments.status, status));
    }

    const rows = await db
      .select({
        id: clinicalDocuments.id,
        patientId: clinicalDocuments.patientId,
        documentType: clinicalDocuments.documentType,
        title: clinicalDocuments.title,
        status: clinicalDocuments.status,
        referencesCid10: clinicalDocuments.referencesCid10,
        finalizedAt: clinicalDocuments.finalizedAt,
        createdAt: clinicalDocuments.createdAt,
        updatedAt: clinicalDocuments.updatedAt,
      })
      .from(clinicalDocuments)
      .where(and(...conditions))
      .orderBy(desc(clinicalDocuments.createdAt));

    // 4. Write audit_log entry for list access (resource_id = patientId)
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'document.list',
        resourceType: 'clinical_document',
        resourceId: patientId,
        metadata: { itemCount: rows.length, type: type ?? null, status: status ?? null },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'document_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for document.list',
      );
    }

    return { ok: true, documents: rows };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'list_documents_failed', errorCode: pgError.code },
      'unexpected error listing clinical documents',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getDocumentDetail
// ---------------------------------------------------------------------------

/**
 * Retrieves full clinical document detail by ID for the authenticated
 * psychologist.
 *
 * RLS guarantees ownership — if the document belongs to a different user,
 * the query returns zero rows and we report NOT_FOUND (no information
 * leakage about existence to unauthorized callers).
 *
 * Flow:
 *   1. Authenticate via Supabase getUser().
 *   2. Validate input with Zod.
 *   3. Fetch document with explicit userId filter (defense-in-depth + RLS).
 *   4. Write audit_log 'document.view'.
 *   5. Return full document.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function getDocumentDetailImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<GetDocumentDetailResult> {
  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  // 2. Validate input
  const parsed = getDocumentDetailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { documentId } = parsed.data;
  const userId = user.id;

  try {
    // 3. Fetch document (defense-in-depth: explicit userId filter + RLS)
    const [document] = await db
      .select()
      .from(clinicalDocuments)
      .where(and(eq(clinicalDocuments.id, documentId), eq(clinicalDocuments.userId, userId)))
      .limit(1);

    if (!document) {
      return { ok: false, code: 'NOT_FOUND' };
    }

    // 4. Write audit_log entry for view access
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'document.view',
        resourceType: 'clinical_document',
        resourceId: documentId,
        metadata: {},
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'document_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for document.view',
      );
    }

    return { ok: true, document };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_document_detail_failed', errorCode: pgError.code },
      'unexpected error fetching clinical document detail',
    );
    throw err;
  }
}

// ---------------------------------------------------------------------------
// finalizeDocument
// ---------------------------------------------------------------------------

/** Document types that require the `analise` section per CFP 06/2019. */
const TYPES_REQUIRING_ANALISE = new Set(['laudo', 'relatorio', 'parecer']);

/**
 * Finalizes a draft clinical document, transitioning it to 'finalized' status.
 *
 * Flow:
 *   1. Validate input with Zod (finalizeDocumentInputSchema).
 *   2. Authenticate via Supabase getUser().
 *   3. Query document by id + userId (defense-in-depth: explicit ownership + RLS).
 *      → NOT_FOUND if missing.
 *   4. If status='finalized' → ALREADY_FINALIZED.
 *   5. Per-type mandatory section validation per CFP 06/2019:
 *      - laudo, relatorio, parecer: require content.analise to be a non-empty string.
 *      - declaracao, atestado: no analise required.
 *      → VALIDATION_ERROR if missing required section.
 *   6. Compute references_cid10 from content:
 *      - If true AND cid10ConsentConfirmed !== true → CID10_CONSENT_REQUIRED (RN-05.06).
 *   7. Update row: status='finalized', finalized_at=now(), references_cid10, cid10_consent_confirmed.
 *   8. Enqueue Inngest event 'documents/pdf.requested' with documentId.
 *   9. Write audit_log 'document.finalize'.
 *   10. Return { ok: true, data: { id } }.
 *
 * user_id is ALWAYS derived from the session — never from client input.
 */
export async function finalizeDocumentImpl(
  supabase: SupabaseClient,
  input: unknown,
): Promise<FinalizeDocumentResult> {
  // 1. Validate input
  const parsed = finalizeDocumentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR' };
  }

  const { documentId, cid10ConsentConfirmed } = parsed.data;

  // 2. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // 3. Fetch document (defense-in-depth: explicit userId filter + RLS)
  const [document] = await db
    .select({
      id: clinicalDocuments.id,
      status: clinicalDocuments.status,
      documentType: clinicalDocuments.documentType,
      content: clinicalDocuments.content,
    })
    .from(clinicalDocuments)
    .where(and(eq(clinicalDocuments.id, documentId), eq(clinicalDocuments.userId, userId)))
    .limit(1);

  if (!document) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  // 4. Check if already finalized
  if (document.status === 'finalized') {
    return { ok: false, code: 'ALREADY_FINALIZED' };
  }

  // 5. Per-type section validation (CFP 06/2019)
  if (TYPES_REQUIRING_ANALISE.has(document.documentType)) {
    const content = document.content as Record<string, unknown> | null;
    const analise = content?.analise;

    if (typeof analise !== 'string' || analise.trim().length === 0) {
      return { ok: false, code: 'VALIDATION_ERROR' };
    }
  }

  // 6. CID-10 consent gate (RN-05.06 / LGPD art. 11)
  const referencesCid10 = computeReferencesCid10(document.content);

  if (referencesCid10 && cid10ConsentConfirmed !== true) {
    return { ok: false, code: 'CID10_CONSENT_REQUIRED' };
  }

  try {
    // 7. Update row to finalized
    await db
      .update(clinicalDocuments)
      .set({
        status: 'finalized',
        finalizedAt: new Date(),
        referencesCid10,
        cid10ConsentConfirmed: cid10ConsentConfirmed ?? false,
        updatedAt: new Date(),
      })
      .where(and(eq(clinicalDocuments.id, documentId), eq(clinicalDocuments.userId, userId)));

    // 8. Enqueue Inngest event for PDF generation
    try {
      await inngest.send({
        name: 'documents/pdf.requested',
        data: { documentId },
      });
    } catch (inngestErr: unknown) {
      // Log but do not fail the finalization — PDF generation can be retried.
      const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
      logger.error(
        { event: 'inngest_send_failed', documentId, error: errMsg },
        'failed to enqueue documents/pdf.requested event',
      );
    }

    // 9. Write audit_log entry
    try {
      await db.insert(auditLog).values({
        userId,
        action: 'document.finalize',
        resourceType: 'clinical_document',
        resourceId: documentId,
        metadata: { referencesCid10, cid10ConsentConfirmed: cid10ConsentConfirmed ?? false },
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'document_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for document.finalize',
      );
    }

    return { ok: true, data: { id: documentId } };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'finalize_document_failed', errorCode: pgError.code },
      'unexpected error finalizing clinical document',
    );
    throw err;
  }
}
