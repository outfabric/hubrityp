import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadPatientPhotoImpl } from '@/modules/patients/server/upload-patient-photo';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Drizzle db module — we test only validation logic here, so DB calls
// are stubbed to simulate "patient found" by default.
vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ id: 'patient-123' }])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock('@/shared/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = 'user-abc-123';
const MOCK_PATIENT_ID = 'patient-123';

function createMockSupabase(overrides?: {
  authenticated?: boolean;
  uploadError?: { message: string } | null;
}) {
  const { authenticated = true, uploadError = null } = overrides ?? {};

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authenticated ? { id: MOCK_USER_ID } : null },
      }),
    },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({
          data: uploadError ? null : { path: `${MOCK_USER_ID}/${MOCK_PATIENT_ID}.jpg` },
          error: uploadError,
        }),
      })),
    },
  } as unknown as Parameters<typeof uploadPatientPhotoImpl>[0];
}

function createMockFile(options?: { type?: string; size?: number; name?: string }): File {
  const { type = 'image/jpeg', size = 1024, name = 'photo.jpg' } = options ?? {};
  // Create a buffer of the specified size
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

function createFormDataWithFile(file: File): FormData {
  const formData = new FormData();
  formData.set('file', file);
  return formData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('uploadPatientPhotoImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns unauthenticated when user is not logged in', async () => {
      const supabase = createMockSupabase({ authenticated: false });
      const formData = createFormDataWithFile(createMockFile());

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({ ok: false, error: 'unauthenticated' });
    });
  });

  describe('file validation — type', () => {
    it('accepts JPEG files', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'image/jpeg' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result.ok).toBe(true);
    });

    it('accepts PNG files', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'image/png' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result.ok).toBe(true);
    });

    it('accepts WebP files', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'image/webp' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result.ok).toBe(true);
    });

    it('rejects GIF files', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'image/gif' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'invalid_file_type',
        message: 'Formato não suportado. Use JPEG, PNG ou WebP.',
      });
    });

    it('rejects SVG files', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'image/svg+xml' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'invalid_file_type',
        message: 'Formato não suportado. Use JPEG, PNG ou WebP.',
      });
    });

    it('rejects PDF files', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'application/pdf' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'invalid_file_type',
        message: 'Formato não suportado. Use JPEG, PNG ou WebP.',
      });
    });

    it('rejects files with empty mime type', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: '' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'invalid_file_type',
        message: 'Formato não suportado. Use JPEG, PNG ou WebP.',
      });
    });
  });

  describe('file validation — size', () => {
    it('accepts file at exactly 2MB', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ size: 2 * 1024 * 1024 }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result.ok).toBe(true);
    });

    it('accepts file under 2MB', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ size: 500_000 }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result.ok).toBe(true);
    });

    it('rejects file over 2MB', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ size: 2 * 1024 * 1024 + 1 }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'file_too_large',
        message: 'Foto deve ter no máximo 2MB.',
      });
    });

    it('rejects file significantly over 2MB', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ size: 10 * 1024 * 1024 }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'file_too_large',
        message: 'Foto deve ter no máximo 2MB.',
      });
    });
  });

  describe('missing file', () => {
    it('returns no_file when formData has no file field', async () => {
      const supabase = createMockSupabase();
      const formData = new FormData();

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'no_file',
        message: 'Nenhum arquivo enviado.',
      });
    });

    it('returns no_file when file field is a string instead of File', async () => {
      const supabase = createMockSupabase();
      const formData = new FormData();
      formData.set('file', 'not-a-file');

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'no_file',
        message: 'Nenhum arquivo enviado.',
      });
    });
  });

  describe('storage upload error', () => {
    it('returns storage_error when Supabase Storage upload fails', async () => {
      const supabase = createMockSupabase({
        uploadError: { message: 'Bucket not found' },
      });
      const formData = createFormDataWithFile(createMockFile());

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: false,
        error: 'storage_error',
        message: 'Erro ao fazer upload da foto. Tente novamente.',
      });
    });
  });

  describe('successful upload', () => {
    it('returns ok with the correct photo path for JPEG', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'image/jpeg' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: true,
        photoPath: `${MOCK_USER_ID}/${MOCK_PATIENT_ID}.jpg`,
      });
    });

    it('returns ok with the correct photo path for PNG', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'image/png' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: true,
        photoPath: `${MOCK_USER_ID}/${MOCK_PATIENT_ID}.png`,
      });
    });

    it('returns ok with the correct photo path for WebP', async () => {
      const supabase = createMockSupabase();
      const formData = createFormDataWithFile(createMockFile({ type: 'image/webp' }));

      const result = await uploadPatientPhotoImpl(supabase, MOCK_PATIENT_ID, formData);

      expect(result).toEqual({
        ok: true,
        photoPath: `${MOCK_USER_ID}/${MOCK_PATIENT_ID}.webp`,
      });
    });
  });
});
