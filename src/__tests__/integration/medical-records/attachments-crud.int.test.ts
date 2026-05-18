import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteAttachmentImpl,
  getAttachmentSignedUrlImpl,
  listAttachmentsImpl,
  uploadAttachmentImpl,
} from '@/modules/medical-records/server/attachments';
import { auditLog, evolutionAttachments } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { cleanTestData } from '../setup/clean-test-data';
import { runAsService } from '../setup/run-as-service';
import { runAsUser } from '../setup/run-as-user';

// ---------------------------------------------------------------------------
// Minimal PDF buffer (magic bytes for PDF: %PDF)
// A real PDF starts with %PDF-1.x — file-type detects this signature.
// ---------------------------------------------------------------------------

const MINIMAL_PDF_BUFFER = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF',
);

// Minimal JPEG buffer (magic bytes: FF D8 FF)
const MINIMAL_JPEG_BUFFER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00,
]);

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

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
      status: 'active',
    });
  });
}

/**
 * Creates a fake SupabaseClient with stubbed auth and storage.
 * Storage upload/createSignedUrl are stubbed because the integration
 * Testcontainers harness does not include a real Supabase Storage service.
 */
function fakeSupabaseClient(
  userId: string | null,
  storageOverrides?: {
    uploadFn?: (...args: unknown[]) => unknown;
    createSignedUrlFn?: (...args: unknown[]) => unknown;
  },
) {
  const uploadFn =
    storageOverrides?.uploadFn ?? vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null });
  const createSignedUrlFn =
    storageOverrides?.createSignedUrlFn ??
    vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/signed?token=abc' },
      error: null,
    });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: uploadFn,
        createSignedUrl: createSignedUrlFn,
      }),
    },
  } as unknown as Parameters<typeof uploadAttachmentImpl>[0];
}

function createFormData(file: File, category: string): FormData {
  const fd = new FormData();
  fd.set('file', file);
  fd.set('category', category);
  return fd;
}

function createPdfFile(name = 'exam-result.pdf', size?: number): File {
  const buf = size ? Buffer.alloc(size, MINIMAL_PDF_BUFFER[0]) : MINIMAL_PDF_BUFFER;
  // When using a synthetic buffer for size testing, the PDF magic bytes
  // get replaced. For size-only tests the MIME check will fail separately,
  // so for functional tests we use the real PDF buffer.
  const content = size ? buf : MINIMAL_PDF_BUFFER;
  return new File([content], name, { type: 'application/pdf' });
}

afterEach(async () => {
  await cleanTestData();
});

// =====================================================================
// uploadAttachmentImpl
// =====================================================================

describe('uploadAttachmentImpl', () => {
  it('persists row + triggers storage upload for valid PDF', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const file = createPdfFile();
    const fd = createFormData(file, 'exam');
    const client = fakeSupabaseClient(userId);

    const result = await uploadAttachmentImpl(client, patientId, fd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBeDefined();
    expect(result.displayName).toBe('exam-result.pdf');

    // Verify DB row
    const rows = await runAsService(async (db) => {
      return db.select().from(evolutionAttachments).where(eq(evolutionAttachments.id, result.id));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.patientId).toBe(patientId);
    expect(rows[0]!.category).toBe('exam');
    expect(rows[0]!.mimeType).toBe('application/pdf');
    expect(rows[0]!.storagePath).toMatch(new RegExp(`^${userId}/${patientId}/[a-f0-9-]+\\.pdf$`));
    expect(rows[0]!.deletedAt).toBeNull();

    // Verify storage upload was called
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock, safe to assert
    expect(client.storage.from).toHaveBeenCalledWith('patient-attachments');
  });

  it('writes audit_log entry for upload', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const fd = createFormData(createPdfFile(), 'exam');
    const result = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    const uploadEntry = auditRows.find((r) => r.action === 'attachment.upload');
    expect(uploadEntry).toBeDefined();
    expect(uploadEntry!.resourceType).toBe('attachment');
    expect(uploadEntry!.resourceId).toBe(result.id);
  });

  it('returns FILE_TOO_LARGE for files exceeding 50 MB', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Create a file > 50 MB (we fake the size via File constructor)
    const bigBuffer = Buffer.alloc(50 * 1024 * 1024 + 1, 0x25); // > 50 MB
    const bigFile = new File([bigBuffer], 'huge.pdf', { type: 'application/pdf' });
    const fd = createFormData(bigFile, 'exam');

    const result = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FILE_TOO_LARGE');
  });

  it('returns INVALID_MIME for spoofed extension (exe renamed to pdf)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // EXE-like magic bytes (MZ header)
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const spoofedFile = new File([exeBuffer], 'malicious.pdf', { type: 'application/pdf' });
    const fd = createFormData(spoofedFile, 'exam');

    const result = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_MIME');
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const fd = createFormData(createPdfFile(), 'exam');
    const result = await uploadAttachmentImpl(fakeSupabaseClient(null), randomUUID(), fd);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns NOT_FOUND when patientId belongs to another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId); // patient belongs to userA

    const fd = createFormData(createPdfFile(), 'exam');
    // userB tries to upload to userA's patient
    const result = await uploadAttachmentImpl(fakeSupabaseClient(userB), patientId, fd);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});

// =====================================================================
// listAttachmentsImpl
// =====================================================================

describe('listAttachmentsImpl', () => {
  it('returns non-deleted items ordered by uploaded_at DESC', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Seed two attachments via the action
    const fd1 = createFormData(createPdfFile('first.pdf'), 'exam');
    const r1 = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd1);
    expect(r1.ok).toBe(true);

    // Small delay to ensure different uploaded_at
    await new Promise((r) => setTimeout(r, 50));

    const fd2 = createFormData(createPdfFile('second.pdf'), 'exam');
    const r2 = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd2);
    expect(r2.ok).toBe(true);

    const result = await listAttachmentsImpl(fakeSupabaseClient(userId), { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachments).toHaveLength(2);
    // Most recent first
    expect(result.attachments[0]!.displayName).toBe('second.pdf');
    expect(result.attachments[1]!.displayName).toBe('first.pdf');
  });

  it('filters by category when provided', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Upload a PDF (exam) and an image
    const fdPdf = createFormData(createPdfFile(), 'exam');
    await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fdPdf);

    const fdImg = createFormData(
      new File([MINIMAL_JPEG_BUFFER], 'photo.jpg', { type: 'image/jpeg' }),
      'image',
    );
    await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fdImg);

    const result = await listAttachmentsImpl(fakeSupabaseClient(userId), {
      patientId,
      category: 'exam',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]!.category).toBe('exam');
  });

  it('soft-deleted attachments hidden from list', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Upload and then soft-delete
    const fd = createFormData(createPdfFile(), 'exam');
    const uploadResult = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;

    await deleteAttachmentImpl(fakeSupabaseClient(userId), { attachmentId: uploadResult.id });

    const result = await listAttachmentsImpl(fakeSupabaseClient(userId), { patientId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachments).toHaveLength(0);
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const result = await listAttachmentsImpl(fakeSupabaseClient(null), { patientId: randomUUID() });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// =====================================================================
// getAttachmentSignedUrlImpl
// =====================================================================

describe('getAttachmentSignedUrlImpl', () => {
  it('returns signed URL for owned attachment', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const fd = createFormData(createPdfFile(), 'exam');
    const uploadResult = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;

    const result = await getAttachmentSignedUrlImpl(fakeSupabaseClient(userId), {
      attachmentId: uploadResult.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signedUrl).toContain('https://');
    expect(result.expiresIn).toBe(300);
  });

  it('writes audit_log attachment.view-url on URL generation', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const fd = createFormData(createPdfFile(), 'exam');
    const uploadResult = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;

    // Clear previous audit entries
    await runAsService(async (db) => {
      await db.delete(auditLog);
    });

    await getAttachmentSignedUrlImpl(fakeSupabaseClient(userId), {
      attachmentId: uploadResult.id,
    });

    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    const viewEntry = auditRows.find((r) => r.action === 'attachment.view-url');
    expect(viewEntry).toBeDefined();
    expect(viewEntry!.resourceType).toBe('attachment');
    expect(viewEntry!.resourceId).toBe(uploadResult.id);
  });

  it('returns NOT_FOUND for non-existent attachment', async () => {
    const userId = randomUUID();
    await seedAuthUser(userId);

    const result = await getAttachmentSignedUrlImpl(fakeSupabaseClient(userId), {
      attachmentId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const result = await getAttachmentSignedUrlImpl(fakeSupabaseClient(null), {
      attachmentId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });
});

// =====================================================================
// deleteAttachmentImpl
// =====================================================================

describe('deleteAttachmentImpl', () => {
  it('sets deleted_at and writes audit_log', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const fd = createFormData(createPdfFile(), 'exam');
    const uploadResult = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;

    // Clear previous audit entries
    await runAsService(async (db) => {
      await db.delete(auditLog);
    });

    const deleteResult = await deleteAttachmentImpl(fakeSupabaseClient(userId), {
      attachmentId: uploadResult.id,
    });

    expect(deleteResult.ok).toBe(true);

    // Verify deleted_at is set
    const rows = await runAsService(async (db) => {
      return db
        .select()
        .from(evolutionAttachments)
        .where(eq(evolutionAttachments.id, uploadResult.id));
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).not.toBeNull();

    // Verify audit_log
    const auditRows = await runAsService(async (db) => {
      return db.select().from(auditLog).where(eq(auditLog.userId, userId));
    });
    const deleteEntry = auditRows.find((r) => r.action === 'attachment.delete');
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.resourceType).toBe('attachment');
    expect(deleteEntry!.resourceId).toBe(uploadResult.id);
  });

  it('returns NOT_FOUND for already soft-deleted attachment', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const fd = createFormData(createPdfFile(), 'exam');
    const uploadResult = await uploadAttachmentImpl(fakeSupabaseClient(userId), patientId, fd);
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;

    // Delete once
    await deleteAttachmentImpl(fakeSupabaseClient(userId), { attachmentId: uploadResult.id });

    // Delete again — should be NOT_FOUND
    const secondDelete = await deleteAttachmentImpl(fakeSupabaseClient(userId), {
      attachmentId: uploadResult.id,
    });

    expect(secondDelete.ok).toBe(false);
    if (secondDelete.ok) return;
    expect(secondDelete.code).toBe('NOT_FOUND');
  });

  it('returns UNAUTHORIZED when no user session', async () => {
    const result = await deleteAttachmentImpl(fakeSupabaseClient(null), {
      attachmentId: randomUUID(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('returns NOT_FOUND for attachment owned by another user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Upload as userA
    const fd = createFormData(createPdfFile(), 'exam');
    const uploadResult = await uploadAttachmentImpl(fakeSupabaseClient(userA), patientId, fd);
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;

    // userB tries to delete
    const deleteResult = await deleteAttachmentImpl(fakeSupabaseClient(userB), {
      attachmentId: uploadResult.id,
    });

    expect(deleteResult.ok).toBe(false);
    if (deleteResult.ok) return;
    expect(deleteResult.code).toBe('NOT_FOUND');
  });
});

// =====================================================================
// RLS negative: cross-psychologist isolation
// =====================================================================

describe('RLS negative: cross-psychologist isolation', () => {
  it('psychologist B cannot list psychologist A attachments via RLS', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Upload as userA
    const fd = createFormData(createPdfFile(), 'exam');
    await uploadAttachmentImpl(fakeSupabaseClient(userA), patientId, fd);

    // userB tries to list via RLS-scoped query
    const visibleToB = await runAsUser(userB, async (db) => {
      return db.select().from(evolutionAttachments);
    });
    expect(visibleToB).toHaveLength(0);

    // userA can see their own
    const visibleToA = await runAsUser(userA, async (db) => {
      return db.select().from(evolutionAttachments);
    });
    expect(visibleToA).toHaveLength(1);
  });

  it('psychologist B cannot get signed URL for psychologist A attachment', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Upload as userA
    const fd = createFormData(createPdfFile(), 'exam');
    const uploadResult = await uploadAttachmentImpl(fakeSupabaseClient(userA), patientId, fd);
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) return;

    // userB tries to get signed URL
    const result = await getAttachmentSignedUrlImpl(fakeSupabaseClient(userB), {
      attachmentId: uploadResult.id,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});
