import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanTestData } from '@/__tests__/integration/setup/clean-test-data';
import { runAsService } from '@/__tests__/integration/setup/run-as-service';
import {
  createDocumentImpl,
  getDocumentDetailImpl,
  listDocumentsByPatientImpl,
  updateDocumentImpl,
} from '@/modules/medical-records/server/clinical-documents';
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

/**
 * Seed a profile with a unique CRP per user to avoid unique constraint
 * violations on (crp_number, crp_uf) when tests create multiple users.
 * Uses the first 7 chars of the userId as the serial portion.
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
    createdAt: Date;
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
      createdAt: overrides?.createdAt ?? undefined,
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
  } as Parameters<typeof createDocumentImpl>[0];
}

afterEach(async () => {
  await cleanTestData();
});

// ===========================================================================
// createDocumentImpl
// ===========================================================================

describe('createDocumentImpl', () => {
  it('creates a draft document and writes audit_log entry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const result = await createDocumentImpl(fakeSupabaseClient(userId), {
      patientId,
      document_type: 'declaracao',
      title: 'Declaracao de comparecimento',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBeDefined();

    // Verify persisted row
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, result.id));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.patientId).toBe(patientId);
    expect(rows[0]!.documentType).toBe('declaracao');
    expect(rows[0]!.status).toBe('draft');
    expect(rows[0]!.title).toBe('Declaracao de comparecimento');

    // Verify psychologistInfo snapshot in content
    const content = rows[0]!.content as Record<string, unknown>;
    const psychInfo = content.psychologistInfo as Record<string, string>;
    expect(psychInfo.name).toBe('Dr. Test Psych');
    const expectedCrpSerial = userId.replace(/-/g, '').slice(0, 7);
    expect(psychInfo.crp).toBe(`06/${expectedCrpSerial}/SP`);

    // Verify audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, result.id));
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('document.create');
    expect(logs[0]!.resourceType).toBe('clinical_document');
    expect(logs[0]!.userId).toBe(userId);
  });

  it('sets user_id from session, never from input', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const result = await createDocumentImpl(fakeSupabaseClient(userId), {
      patientId,
      document_type: 'atestado',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, result.id));
    });

    expect(rows[0]!.userId).toBe(userId);
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await createDocumentImpl(fakeSupabaseClient(null), {
      patientId: randomUUID(),
      document_type: 'declaracao',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns NOT_FOUND when patient does not belong to user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userB);
    await seedPatient(userA, patientId);

    // userB tries to create document for userA's patient
    const result = await createDocumentImpl(fakeSupabaseClient(userB), {
      patientId,
      document_type: 'declaracao',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns VALIDATION_ERROR for invalid input', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);

    const result = await createDocumentImpl(fakeSupabaseClient(userId), {
      patientId: 'not-a-uuid',
      document_type: 'invalid-type',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// updateDocumentImpl
// ===========================================================================

describe('updateDocumentImpl', () => {
  it('updates a draft document content and title, writes audit_log', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId);

    const result = await updateDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
      title: 'Updated title',
      content: {
        body: 'updated content',
        cid10Codes: [{ code: 'F32.0', description: 'Depression' }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBe(docId);

    // Verify updated row
    const rows = await runAsService(async (db) => {
      return db.select().from(clinicalDocuments).where(eq(clinicalDocuments.id, docId));
    });

    expect(rows[0]!.title).toBe('Updated title');
    const content = rows[0]!.content as Record<string, unknown>;
    expect(content.body).toBe('updated content');
    // references_cid10 should be recomputed to true
    expect(rows[0]!.referencesCid10).toBe(true);

    // Verify audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, docId));
    });

    const updateLog = logs.find((l) => l.action === 'document.update');
    expect(updateLog).toBeDefined();
    expect(updateLog!.userId).toBe(userId);
  });

  it('rejects update on finalized document with ALREADY_FINALIZED', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      status: 'finalized',
      finalizedAt: new Date(),
    });

    const result = await updateDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
      title: 'Attempted edit',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('ALREADY_FINALIZED');
  });

  it('returns NOT_FOUND when document does not belong to user (ownership check)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientId);

    const docId = await seedDraftDocument(userA, patientId);

    // userB tries to update userA's document
    const result = await updateDocumentImpl(fakeSupabaseClient(userB), {
      documentId: docId,
      title: 'Hacked',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await updateDocumentImpl(fakeSupabaseClient(null), {
      documentId: randomUUID(),
      title: 'Test',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns VALIDATION_ERROR for invalid input', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await updateDocumentImpl(fakeSupabaseClient(userId), {
      documentId: 'not-a-uuid',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// listDocumentsByPatientImpl
// ===========================================================================

describe('listDocumentsByPatientImpl', () => {
  it('returns documents ordered by created_at DESC (newest first)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    // Seed 3 documents with explicit timestamps
    await seedDraftDocument(userId, patientId, {
      title: 'Oldest',
      createdAt: new Date('2024-01-01T10:00:00Z'),
    });
    await seedDraftDocument(userId, patientId, {
      title: 'Middle',
      createdAt: new Date('2024-06-01T10:00:00Z'),
    });
    await seedDraftDocument(userId, patientId, {
      title: 'Newest',
      createdAt: new Date('2024-12-01T10:00:00Z'),
    });

    const result = await listDocumentsByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents).toHaveLength(3);
    expect(result.documents[0]!.title).toBe('Newest');
    expect(result.documents[1]!.title).toBe('Middle');
    expect(result.documents[2]!.title).toBe('Oldest');
  });

  it('filters by document type', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    await seedDraftDocument(userId, patientId, { documentType: 'declaracao' });
    await seedDraftDocument(userId, patientId, { documentType: 'atestado' });
    await seedDraftDocument(userId, patientId, { documentType: 'declaracao' });

    const result = await listDocumentsByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
      type: 'declaracao',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents).toHaveLength(2);
    expect(result.documents.every((d) => d.documentType === 'declaracao')).toBe(true);
  });

  it('filters by status', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    await seedDraftDocument(userId, patientId, { status: 'draft' });
    await seedDraftDocument(userId, patientId, {
      status: 'finalized',
      finalizedAt: new Date(),
    });
    await seedDraftDocument(userId, patientId, { status: 'draft' });

    const result = await listDocumentsByPatientImpl(fakeSupabaseClient(userId), {
      patientId,
      status: 'draft',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents).toHaveLength(2);
    expect(result.documents.every((d) => d.status === 'draft')).toBe(true);
  });

  it('writes audit_log with action document.list', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    await listDocumentsByPatientImpl(fakeSupabaseClient(userId), { patientId });

    // Verify audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, patientId));
    });

    const listLog = logs.find((l) => l.action === 'document.list');
    expect(listLog).toBeDefined();
    expect(listLog!.resourceType).toBe('clinical_document');
    expect(listLog!.userId).toBe(userId);
  });

  it('returns only documents for the requesting psychologist (RLS negative)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientIdA = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientIdA);

    await seedDraftDocument(userA, patientIdA);

    // userB requests documents for userA's patient — should return empty
    const result = await listDocumentsByPatientImpl(fakeSupabaseClient(userB), {
      patientId: patientIdA,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.documents).toHaveLength(0);
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await listDocumentsByPatientImpl(fakeSupabaseClient(null), {
      patientId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// ===========================================================================
// getDocumentDetailImpl
// ===========================================================================

describe('getDocumentDetailImpl', () => {
  it('returns full document content for the owner', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId, {
      content: { body: 'detailed content', section: 'analysis' },
    });

    const result = await getDocumentDetailImpl(fakeSupabaseClient(userId), {
      documentId: docId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.id).toBe(docId);
    expect(result.document.userId).toBe(userId);
    expect(result.document.patientId).toBe(patientId);
    const content = result.document.content as Record<string, unknown>;
    expect(content.body).toBe('detailed content');
    expect(content.section).toBe('analysis');
  });

  it('writes audit_log with action document.view', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    const docId = await seedDraftDocument(userId, patientId);

    await getDocumentDetailImpl(fakeSupabaseClient(userId), { documentId: docId });

    // Verify audit_log entry
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.resourceId, docId));
    });

    const viewLog = logs.find((l) => l.action === 'document.view');
    expect(viewLog).toBeDefined();
    expect(viewLog!.resourceType).toBe('clinical_document');
    expect(viewLog!.userId).toBe(userId);
  });

  it('returns NOT_FOUND for non-existent document', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);

    const result = await getDocumentDetailImpl(fakeSupabaseClient(userId), {
      documentId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns NOT_FOUND when document belongs to another user (RLS negative)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedProfile(userA);
    await seedProfile(userB);
    await seedPatient(userA, patientId);

    const docId = await seedDraftDocument(userA, patientId);

    // userB tries to view userA's document
    const result = await getDocumentDetailImpl(fakeSupabaseClient(userB), {
      documentId: docId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when not authenticated', async () => {
    const result = await getDocumentDetailImpl(fakeSupabaseClient(null), {
      documentId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// ===========================================================================
// Cross-cutting: audit_log entries written for every operation
// ===========================================================================

describe('clinical-documents — audit trail completeness', () => {
  it('each CRUD operation writes a distinct audit_log entry', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedProfile(userId);
    await seedPatient(userId, patientId);

    // 1. Create
    const createResult = await createDocumentImpl(fakeSupabaseClient(userId), {
      patientId,
      document_type: 'relatorio',
      title: 'Relatorio completo',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const docId = createResult.id;

    // 2. Update
    const updateResult = await updateDocumentImpl(fakeSupabaseClient(userId), {
      documentId: docId,
      title: 'Relatorio atualizado',
    });
    expect(updateResult.ok).toBe(true);

    // 3. List
    await listDocumentsByPatientImpl(fakeSupabaseClient(userId), { patientId });

    // 4. Detail
    await getDocumentDetailImpl(fakeSupabaseClient(userId), { documentId: docId });

    // Verify all 4 audit actions exist
    const logs = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });

    const actions = logs.map((l) => l.action);
    expect(actions).toContain('document.create');
    expect(actions).toContain('document.update');
    expect(actions).toContain('document.list');
    expect(actions).toContain('document.view');
  });
});
