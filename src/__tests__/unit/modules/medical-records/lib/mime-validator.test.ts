import { describe, expect, it } from 'vitest';

import { validateMimeType } from '@/modules/medical-records/lib/mime-validator';

// ---------------------------------------------------------------------------
// Minimal magic-byte fixtures
//
// These are real file signatures (magic bytes) — small enough to inline, large
// enough for `file-type` to detect. We avoid mocking the library so the tests
// exercise the actual detection pipeline (design.md Decision #3).
// ---------------------------------------------------------------------------

/** Minimal valid PDF: header + enough structure for detection. */
const PDF_MAGIC = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n', 'ascii');

/**
 * Minimal valid PNG: 8-byte signature + IHDR chunk (required by the spec).
 * IHDR is 13 bytes of data: width(4) + height(4) + bitDepth(1) +
 * colorType(1) + compression(1) + filter(1) + interlace(1).
 */
const PNG_MAGIC = Buffer.from([
  // PNG signature
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  // IHDR chunk length (13 = 0x0000000D)
  0x00, 0x00, 0x00, 0x0d,
  // "IHDR"
  0x49, 0x48, 0x44, 0x52,
  // width=1, height=1
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  // bitDepth=8, colorType=2 (RGB), compression=0, filter=0, interlace=0
  0x08, 0x02, 0x00, 0x00, 0x00,
  // CRC (4 bytes, placeholder — file-type does not validate CRC)
  0x00, 0x00, 0x00, 0x00,
]);

/**
 * Windows PE executable magic bytes (MZ header).
 * file-type detects this as `application/x-msdownload` / `exe`.
 */
const EXE_MAGIC = Buffer.alloc(512);
// DOS MZ header
EXE_MAGIC[0] = 0x4d; // 'M'
EXE_MAGIC[1] = 0x5a; // 'Z'
// PE header offset at 0x3C (little-endian)
EXE_MAGIC[0x3c] = 0x80;
EXE_MAGIC[0x3d] = 0x00;
EXE_MAGIC[0x3e] = 0x00;
EXE_MAGIC[0x3f] = 0x00;
// PE signature at offset 0x80
EXE_MAGIC[0x80] = 0x50; // 'P'
EXE_MAGIC[0x81] = 0x45; // 'E'
EXE_MAGIC[0x82] = 0x00;
EXE_MAGIC[0x83] = 0x00;

/** Buffer with no recognizable magic bytes. */
const GARBAGE_BYTES = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateMimeType', () => {
  it('accepts a real PDF for the exam category', async () => {
    const result = await validateMimeType(PDF_MAGIC, 'exam');
    expect(result.valid).toBe(true);
    expect(result.detectedMime).toBe('application/pdf');
    expect(result.detectedExt).toBe('pdf');
  });

  it('accepts a real PNG for the image category', async () => {
    const result = await validateMimeType(PNG_MAGIC, 'image');
    expect(result.valid).toBe(true);
    expect(result.detectedMime).toBe('image/png');
    expect(result.detectedExt).toBe('png');
  });

  it('accepts a real PNG for the drawing category', async () => {
    const result = await validateMimeType(PNG_MAGIC, 'drawing');
    expect(result.valid).toBe(true);
    expect(result.detectedMime).toBe('image/png');
  });

  it('rejects a PNG when category is audio', async () => {
    const result = await validateMimeType(PNG_MAGIC, 'audio');
    expect(result.valid).toBe(false);
    expect(result.detectedMime).toBe('image/png');
  });

  it('rejects a renamed .exe posing as .pdf (magic-bytes check)', async () => {
    const result = await validateMimeType(EXE_MAGIC, 'exam');
    expect(result.valid).toBe(false);
    // The detected MIME should be the executable type, not PDF
    expect(result.detectedMime).not.toBe('application/pdf');
  });

  it('rejects a file with no detectable type gracefully', async () => {
    const result = await validateMimeType(GARBAGE_BYTES, 'exam');
    expect(result.valid).toBe(false);
    expect(result.detectedMime).toBeUndefined();
    expect(result.detectedExt).toBeUndefined();
  });

  it('accepts a PDF for the other category', async () => {
    const result = await validateMimeType(PDF_MAGIC, 'other');
    expect(result.valid).toBe(true);
    expect(result.detectedMime).toBe('application/pdf');
  });

  it('rejects a PDF when category is image', async () => {
    const result = await validateMimeType(PDF_MAGIC, 'image');
    expect(result.valid).toBe(false);
    expect(result.detectedMime).toBe('application/pdf');
  });
});
