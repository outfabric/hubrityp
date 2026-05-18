import { fileTypeFromBuffer } from 'file-type';

import type { AttachmentCategory } from './attachment-schemas';
import { MIME_ALLOWLIST } from './attachment-schemas';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface MimeValidationResult {
  valid: boolean;
  detectedMime: string | undefined;
  detectedExt: string | undefined;
}

// ---------------------------------------------------------------------------
// Magic-bytes MIME validation
// ---------------------------------------------------------------------------

/**
 * Validates the actual MIME type of a file buffer against the per-category
 * allowlist using magic-bytes detection (not the client-supplied Content-Type).
 *
 * See design.md Decision #3 for the rationale. The `file-type` package reads
 * the first bytes to determine the real file type, preventing renamed-extension
 * attacks (e.g., an .exe masquerading as .pdf).
 *
 * Returns `{ valid: false }` when:
 * - The file type cannot be detected (no magic bytes match).
 * - The detected MIME is not in the allowlist for the given category.
 */
export async function validateMimeType(
  buffer: Buffer,
  category: AttachmentCategory,
): Promise<MimeValidationResult> {
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    return { valid: false, detectedMime: undefined, detectedExt: undefined };
  }

  const allowedMimes = MIME_ALLOWLIST[category];
  const valid = allowedMimes.includes(detected.mime);

  return {
    valid,
    detectedMime: detected.mime,
    detectedExt: detected.ext,
  };
}
