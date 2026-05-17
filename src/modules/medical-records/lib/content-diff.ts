/**
 * Content comparison helper for evolution notes.
 *
 * Uses JSON.stringify to determine whether two content payloads differ.
 * Handles null/undefined gracefully by treating them as equivalent
 * serializable values.
 */

/**
 * Returns true if `prev` and `next` represent different content.
 * Both values are serialized via JSON.stringify for comparison.
 */
export function contentHasChanged(prev: unknown, next: unknown): boolean {
  return JSON.stringify(prev) !== JSON.stringify(next);
}
