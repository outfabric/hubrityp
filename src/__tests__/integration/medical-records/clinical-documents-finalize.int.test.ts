import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import { finalizeDocumentImpl } from '@/modules/medical-records/server/clinical-documents';
import { profiles } from '@/shared/db/schema/auth/tables';
import { auditLog, clinicalDocuments } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

// ---------------------------------------------------------------------------
// Mock Inngest — capture events without actually enqueuing.
// vi.hoisted() runs before vi.mock() hoisting, so the fn is available in the
// factory without triggering "Cannot access before initialization".
// ---------------------------------------------------------------------------

const { mockInngestSend } = vi.hoisted(() => ({
  mockInngestSend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/medical-records/inngest/client', () => ({
  inngest: { send: mockInngestSend },
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

/**
 * Seed a profile with a unique CRP per user to avoid unique constraint
 * violations on (crp_number, crp_uf) when tests create multiple users.
 */
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

async function seedDraftDocument(
  userId: string,
  patientId: string,
  overrides?: Partial<{
    id: string;
    documentType: string;
    status: string;
    title: string;
    content: Record<string, unknown>;
    finalizedAt: Date;
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
      content: overrides?.content ?? { body: 'test content' },
      status: overrides?.status ?? 'draft',
      finalizedAt: overrides?.finalizedAt ?? null,
    });
  });
  return docId;
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
  } as Parameters<typeof finalizeDocumentImpl>[0];
}

afterEach(async () => {
  vi.clearAllMocks();
  await cleanTestData();
});

// ===========================================================================
// finalizeDocumentImpl
// ===========================================================================

describe('finalizeDocumentImpl', () => {
  // -----------------------------------------------------------------------
  // Happy paths
  // -----------------------------------------------------------------------

  it('finalizes a draft document without CID-10 codes — status=finalized, event sent, audit entry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'declaracao',
      content: {
        solicitante: 'Empresa X',
        demanda: 'Comparecimento',
        procedimentos: 'Sessao',
        conclusao: 'Confirmado',
        localData: { local: 'Sao Paulo', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr. Test', crp: '06/12345', contact: '' },
      },
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe(docId);

    // Verify persisted row
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('finalized');
    expect(rows[0]!.finalizedAt).toBeTruthy();
    expect(rows[0]!.referencesCid10).toBe(false);
    expect(rows[0]!.cid10ConsentConfirmed).toBe(false);

    // Verify Inngest event was sent
    expect(mockInngestSend).toHaveBeenCalledTimes(1);
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'documents/pdf.requested',
      data: { documentId: docId },
    });

    // Verify audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, docId));
    });

    const finalizeLog = logs.find((l) => l.action === 'document.finalize');
    expect(finalizeLog).toBeDefined();
    expect(finalizeLog!.userId).toBe(userId);
    expect(finalizeLog!.resourceType).toBe('clinical_document');
  });

  it('finalizes with CID-10 codes + consent=true — references_cid10=true, consent stored', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'declaracao',
      content: {
        solicitante: 'Empresa X',
        demanda: 'Comparecimento',
        procedimentos: 'Sessao',
        conclusao: 'Confirmado',
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr. Test', crp: '06/12345', contact: '' },
        cid10Codes: [{ code: 'F32.0', description: 'Episodio depressivo leve' }],
      },
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
      cid10ConsentConfirmed: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify persisted row
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows[0]!.status).toBe('finalized');
    expect(rows[0]!.referencesCid10).toBe(true);
    expect(rows[0]!.cid10ConsentConfirmed).toBe(true);

    // Verify Inngest event was sent
    expect(mockInngestSend).toHaveBeenCalledTimes(1);
  });

  it('finalizes laudo with analise section present — succeeds', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'laudo',
      content: {
        document_type: 'laudo',
        solicitante: 'Juiz',
        demanda: 'Avaliacao',
        procedimentos: 'Entrevistas',
        conclusao: 'Apto',
        analise: 'Analise detalhada do caso',
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr. Test', crp: '06/12345', contact: '' },
      },
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe(docId);

    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows[0]!.status).toBe('finalized');
  });

  // -----------------------------------------------------------------------
  // Error: CID-10 consent required
  // -----------------------------------------------------------------------

  it('rejects finalization with CID-10 codes + consent=false → CID10_CONSENT_REQUIRED', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'declaracao',
      content: {
        solicitante: 'Empresa',
        demanda: 'D',
        procedimentos: 'P',
        conclusao: 'C',
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr', crp: '06/1', contact: '' },
        cid10Codes: [{ code: 'F41.0', description: 'Transtorno de panico' }],
      },
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
      cid10ConsentConfirmed: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CID10_CONSENT_REQUIRED');

    // Verify document was NOT finalized
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });
    expect(rows[0]!.status).toBe('draft');

    // Verify Inngest event was NOT sent
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('rejects finalization with CID-10 codes + consent missing → CID10_CONSENT_REQUIRED', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'declaracao',
      content: {
        solicitante: 'Empresa',
        demanda: 'D',
        procedimentos: 'P',
        conclusao: 'C',
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr', crp: '06/1', contact: '' },
        cid10Codes: [{ code: 'F41.0', description: 'Transtorno de panico' }],
      },
    });

    // consent omitted (defaults to false via schema)
    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CID10_CONSENT_REQUIRED');
  });

  // -----------------------------------------------------------------------
  // Error: Missing analise for laudo
  // -----------------------------------------------------------------------

  it('rejects finalization of laudo without analise → VALIDATION_ERROR', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'laudo',
      content: {
        document_type: 'laudo',
        solicitante: 'Juiz',
        demanda: 'Avaliacao',
        procedimentos: 'Entrevistas',
        conclusao: 'Apto',
        // analise intentionally missing
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr', crp: '06/1', contact: '' },
      },
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');

    // Verify document was NOT finalized
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });
    expect(rows[0]!.status).toBe('draft');
  });

  it('rejects finalization of relatorio without analise → VALIDATION_ERROR', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'relatorio',
      content: {
        document_type: 'relatorio',
        solicitante: 'Escola',
        demanda: 'Avaliacao',
        procedimentos: 'Sessoes',
        conclusao: 'Concluido',
        // analise intentionally missing
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr', crp: '06/1', contact: '' },
      },
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('rejects finalization of parecer without analise → VALIDATION_ERROR', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'parecer',
      content: {
        document_type: 'parecer',
        solicitante: 'Tribunal',
        demanda: 'Opiniao',
        procedimentos: 'Analise documental',
        conclusao: 'Parecer favoravel',
        // analise intentionally missing
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr', crp: '06/1', contact: '' },
      },
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('rejects finalization of laudo with empty-string analise → VALIDATION_ERROR', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'laudo',
      content: {
        document_type: 'laudo',
        solicitante: 'Juiz',
        demanda: 'Avaliacao',
        procedimentos: 'Entrevistas',
        conclusao: 'Apto',
        analise: '   ', // whitespace-only — should be rejected
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr', crp: '06/1', contact: '' },
      },
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  // -----------------------------------------------------------------------
  // Error: Already finalized
  // -----------------------------------------------------------------------

  it('rejects finalization of already-finalized document → ALREADY_FINALIZED', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      status: 'finalized',
      finalizedAt: new Date(),
    });

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ALREADY_FINALIZED');
  });

  // -----------------------------------------------------------------------
  // Error: Cross-tenant isolation (RLS negative)
  // -----------------------------------------------------------------------

  it('returns NOT_FOUND when psychologist B tries to finalize psychologist A document', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientId);

    const docId = await seedDraftDocument(userA, patientId, {
      documentType: 'declaracao',
    });

    // userB tries to finalize userA's document
    const result = await finalizeDocumentImpl(fakeSupabaseClient(userB), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');

    // Verify document status was NOT changed
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });
    expect(rows[0]!.status).toBe('draft');
  });

  // -----------------------------------------------------------------------
  // Error: Authentication
  // -----------------------------------------------------------------------

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await finalizeDocumentImpl(fakeSupabaseClient(null), {
      documentId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  // -----------------------------------------------------------------------
  // Error: Validation
  // -----------------------------------------------------------------------

  it('returns VALIDATION_ERROR for invalid documentId', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: 'not-a-uuid',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  // -----------------------------------------------------------------------
  // Audit trail
  // -----------------------------------------------------------------------

  it('writes audit_log entry with metadata on successful finalization', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      documentType: 'declaracao',
      content: {
        solicitante: 'E',
        demanda: 'D',
        procedimentos: 'P',
        conclusao: 'C',
        localData: { local: 'SP', data: '2024-01-01' },
        psychologistInfo: { name: 'Dr', crp: '06/1', contact: '' },
        cid10Codes: [{ code: 'F32.0', description: 'Depression' }],
      },
    });

    await finalizeDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
      cid10ConsentConfirmed: true,
    });

    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, docId));
    });

    const finalizeLog = logs.find((l) => l.action === 'document.finalize');
    expect(finalizeLog).toBeDefined();
    expect(finalizeLog!.userId).toBe(userId);
    expect(finalizeLog!.resourceType).toBe('clinical_document');

    const metadata = finalizeLog!.metadata as Record<string, unknown>;
    expect(metadata.referencesCid10).toBe(true);
    expect(metadata.cid10ConsentConfirmed).toBe(true);
  });
});
