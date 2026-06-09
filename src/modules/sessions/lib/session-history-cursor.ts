/**
 * Opaque pagination cursor for the descending session-history list.
 *
 * The list is ordered `start_at DESC, id DESC`, so a stable keyset cursor must
 * encode BOTH the last row's `start_at` and its `id` (ties on `start_at` are
 * broken by `id`). The cursor is base64url-encoded JSON of `{ startAt, id }` —
 * opaque to the client, decoded only server-side. A malformed or tampered
 * cursor decodes to `null` and is treated as "no cursor" (first page) rather
 * than throwing, so a bad value can never leak an error or shift another
 * tenant's data into view (the owner predicate still scopes the query).
 */

export interface SessionHistoryCursor {
  /** ISO-8601 `start_at` of the last row of the previous page. */
  startAt: string;
  /** `id` of the last row of the previous page (tie-breaker). */
  id: string;
}

/** Encodes a keyset cursor as an opaque base64url string. */
export function encodeSessionHistoryCursor(cursor: SessionHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor back to `{ startAt, id }`, or returns `null` for any
 * malformed / tampered input (invalid base64, invalid JSON, missing fields,
 * non-ISO date, non-UUID-shaped id). Callers treat `null` as "first page".
 */
export function decodeSessionHistoryCursor(raw: string): SessionHistoryCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);

    if (typeof parsed !== 'object' || parsed === null) return null;

    const { startAt, id } = parsed as Record<string, unknown>;
    if (typeof startAt !== 'string' || typeof id !== 'string') return null;

    // Reject a non-parseable timestamp so it can never reach the SQL predicate.
    if (Number.isNaN(Date.parse(startAt))) return null;

    return { startAt, id };
  } catch {
    return null;
  }
}
