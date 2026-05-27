import 'server-only';

import { fileTypeFromBuffer } from 'file-type';

// ---------------------------------------------------------------------------
// Allowed MIME types for audio upload
// ---------------------------------------------------------------------------

/**
 * The exact set of MIME types the platform accepts for clinical audio uploads.
 * Any detected type outside this set is rejected even if `file-type` recognizes it.
 */
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg', // .mp3
  'audio/mp4', // .m4a (some encoders)
  'audio/wav', // .wav
  'audio/webm', // .webm (declared by browsers)
  'audio/x-m4a', // .m4a (Apple / file-type canonical)
]);

// ---------------------------------------------------------------------------
// Normalization map
// ---------------------------------------------------------------------------

/**
 * `file-type` may return a MIME that differs from the browser-declared one for
 * the same logical format. This map normalizes detected MIMEs to the canonical
 * values in {@link ALLOWED_AUDIO_MIMES} so the comparison is format-aware.
 *
 * - `video/webm` → `audio/webm`: WebM is a container; `file-type` always
 *   returns `video/webm` because it cannot distinguish audio-only WebM from
 *   video WebM at the magic-number level. Browsers declare `audio/webm` for
 *   audio-only recordings, so we normalize to match.
 * - `audio/x-wav` → `audio/wav`: Legacy MIME; `file-type` v22 returns
 *   `audio/wav`, but we guard against future changes.
 * - `audio/vnd.wave` → `audio/wav`: RFC 2361 registered form.
 */
const NORMALIZE_DETECTED: ReadonlyMap<string, string> = new Map([
  ['video/webm', 'audio/webm'],
  ['audio/x-wav', 'audio/wav'],
  ['audio/vnd.wave', 'audio/wav'],
]);

/**
 * Normalizes a declared content-type the same way so both sides of the
 * comparison use the same canonical form.
 */
const NORMALIZE_DECLARED: ReadonlyMap<string, string> = new Map([
  ['audio/x-wav', 'audio/wav'],
  ['audio/vnd.wave', 'audio/wav'],
  ['video/webm', 'audio/webm'],
]);

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type MimeValidationOk = { ok: true; detected: string };

export type MimeValidationFail = {
  ok: false;
  reason: 'undetected' | 'mismatch' | 'not_allowed';
};

export type MimeValidationResult = MimeValidationOk | MimeValidationFail;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates that the binary content of a buffer matches the declared
 * content-type AND that the detected type is in the allowed audio set.
 *
 * The function uses the `file-type` library to inspect magic numbers and then:
 *
 * 1. If `file-type` cannot detect the type → `{ ok: false, reason: 'undetected' }`.
 * 2. If the detected (normalized) MIME is not in {@link ALLOWED_AUDIO_MIMES}
 *    → `{ ok: false, reason: 'not_allowed' }`.
 * 3. If the detected format does not match the declared content-type
 *    (after normalization) → `{ ok: false, reason: 'mismatch' }`.
 * 4. Otherwise → `{ ok: true, detected: <normalized MIME> }`.
 *
 * @param buffer       First bytes of the file (the full file is fine too).
 * @param declaredContentType  The MIME from the client (e.g., the `Content-Type`
 *                             header or the `<input>` file object's `.type`).
 */
export async function validateAudioMagicNumbers(
  buffer: Buffer | Uint8Array,
  declaredContentType: string,
): Promise<MimeValidationResult> {
  const result = await fileTypeFromBuffer(buffer);

  // 1. Magic numbers not recognized at all
  if (!result) {
    return { ok: false, reason: 'undetected' };
  }

  const detectedRaw = result.mime;
  const detectedNormalized = NORMALIZE_DETECTED.get(detectedRaw) ?? detectedRaw;

  // 2. Detected format is not in the allowed audio set
  if (!ALLOWED_AUDIO_MIMES.has(detectedNormalized)) {
    return { ok: false, reason: 'not_allowed' };
  }

  // 3. Compare normalized detected vs. normalized declared
  const declaredNormalized = NORMALIZE_DECLARED.get(declaredContentType) ?? declaredContentType;

  // WebM special case: browser declares `audio/webm`, file-type detects
  // `video/webm` → after normalization both are `audio/webm`, so they match.
  // M4A: `audio/x-m4a` and `audio/mp4` are both allowed and refer to the
  // same container (MPEG-4 Part 14). Treat them as compatible.
  if (!mimesAreCompatible(detectedNormalized, declaredNormalized)) {
    return { ok: false, reason: 'mismatch' };
  }

  return { ok: true, detected: detectedNormalized };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Two normalized MIMEs are "compatible" when they refer to the same logical
 * format. Most of the time this is strict equality, but MPEG-4 audio has two
 * registered MIMEs (`audio/mp4` and `audio/x-m4a`) that are interchangeable.
 */
function mimesAreCompatible(a: string, b: string): boolean {
  if (a === b) return true;

  // MPEG-4 audio: `audio/mp4` ↔ `audio/x-m4a`
  const m4aSet = new Set(['audio/mp4', 'audio/x-m4a']);
  if (m4aSet.has(a) && m4aSet.has(b)) return true;

  return false;
}
