import { describe, expect, it } from 'vitest';

import {
  MAX_FILE_SIZE_BYTES,
  attachmentCategorySchema,
  uploadAttachmentInputSchema,
} from '@/modules/medical-records/lib/attachment-schemas';

// ---------------------------------------------------------------------------
// attachmentCategorySchema
// ---------------------------------------------------------------------------

describe('attachmentCategorySchema', () => {
  const VALID_CATEGORIES = ['exam', 'image', 'drawing', 'audio', 'other'] as const;

  it.each(VALID_CATEGORIES)('accepts valid category "%s"', (category) => {
    expect(attachmentCategorySchema.safeParse(category).success).toBe(true);
  });

  it('rejects an invalid category', () => {
    const result = attachmentCategorySchema.safeParse('video');
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(attachmentCategorySchema.safeParse('').success).toBe(false);
  });

  it('rejects a number', () => {
    expect(attachmentCategorySchema.safeParse(42).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MAX_FILE_SIZE_BYTES
// ---------------------------------------------------------------------------

describe('MAX_FILE_SIZE_BYTES', () => {
  it('equals exactly 50 MB in bytes', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('accepts a file at exactly 50 MB (boundary)', () => {
    // Application-level check: file size <= MAX_FILE_SIZE_BYTES
    const fileSize = MAX_FILE_SIZE_BYTES;
    expect(fileSize <= MAX_FILE_SIZE_BYTES).toBe(true);
  });

  it('rejects a file at 50 MB + 1 byte', () => {
    const fileSize = MAX_FILE_SIZE_BYTES + 1;
    expect(fileSize <= MAX_FILE_SIZE_BYTES).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// uploadAttachmentInputSchema
// ---------------------------------------------------------------------------

describe('uploadAttachmentInputSchema', () => {
  const VALID_INPUT = {
    patientId: '550e8400-e29b-41d4-a716-446655440000',
    category: 'exam' as const,
  };

  it('accepts a valid input', () => {
    expect(uploadAttachmentInputSchema.safeParse(VALID_INPUT).success).toBe(true);
  });

  it('rejects when patientId is not a valid UUID', () => {
    const result = uploadAttachmentInputSchema.safeParse({
      ...VALID_INPUT,
      patientId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when patientId is missing', () => {
    const result = uploadAttachmentInputSchema.safeParse({
      category: 'exam',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when category is invalid', () => {
    const result = uploadAttachmentInputSchema.safeParse({
      ...VALID_INPUT,
      category: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when category is missing', () => {
    const result = uploadAttachmentInputSchema.safeParse({
      patientId: VALID_INPUT.patientId,
    });
    expect(result.success).toBe(false);
  });

  it.each(['exam', 'image', 'drawing', 'audio', 'other'] as const)(
    'accepts category "%s" in a full input',
    (category) => {
      const result = uploadAttachmentInputSchema.safeParse({
        ...VALID_INPUT,
        category,
      });
      expect(result.success).toBe(true);
    },
  );
});
