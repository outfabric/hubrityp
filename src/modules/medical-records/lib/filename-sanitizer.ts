import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Display name sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitizes a user-supplied filename for safe display.
 *
 * Strips:
 * - Path separators (`/`, `\\`) and traversal sequences (`..`)
 * - Control characters (U+0000–U+001F, U+007F–U+009F)
 * - Leading/trailing whitespace
 *
 * Truncates to 255 characters (common filesystem limit).
 * Returns a fallback name if the result is empty after sanitization.
 */
export function sanitizeDisplayName(original: string): string {
  // Remove path separators and traversal sequences
  let sanitized = original.replace(/\.\./g, '').replace(/[/\\]/g, '');

  // Remove control characters (C0 + DEL + C1 ranges)
  sanitized = sanitized.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  // Truncate to 255 characters
  if (sanitized.length > 255) {
    sanitized = sanitized.slice(0, 255);
  }

  // Fallback for empty result
  if (sanitized.length === 0) {
    return 'arquivo-sem-nome';
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Storage filename generation
// ---------------------------------------------------------------------------

/**
 * Generates a server-side UUID-based filename for storage.
 *
 * The original user-supplied name is never used as the storage key — this
 * prevents path-traversal, name-collision, and encoding issues. The
 * `displayName` is stored separately in the DB row for user-facing display.
 */
export function generateStorageFilename(ext: string): string {
  // Strip leading dot if present (defensive)
  const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
  return `${randomUUID()}.${cleanExt}`;
}
