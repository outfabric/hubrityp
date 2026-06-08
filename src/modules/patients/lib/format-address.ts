// Formats a patient address for human-readable display.
//
// The `patients.address` column stores a JSON-serialized object (see
// `src/shared/db/schema/patients/tables.ts`). The patient detail "Visão geral"
// tab previously rendered that raw JSON string verbatim; this helper parses it
// and produces a Brazilian-formatted address so the UI shows
// "Rua Exemplo, 123, Apto 4 - Centro - São Paulo, SP 01001-000" instead.

/**
 * Recognized fields of a serialized patient address. Every field is optional
 * because historical / partially-filled records may omit any of them. We accept
 * `unknown` per field and coerce defensively rather than trusting the shape,
 * since the value originates from stored JSON that we cannot retroactively
 * validate.
 */
interface ParsedAddress {
  street?: unknown;
  number?: unknown;
  complement?: unknown;
  neighborhood?: unknown;
  city?: unknown;
  state?: unknown;
  zipCode?: unknown;
}

/** Returns the trimmed string value, or `null` when absent/blank/non-string. */
function cleanPart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parses a JSON-serialized patient address and returns a Brazilian-formatted,
 * human-readable string.
 *
 * Format: `street, number, complement - neighborhood - city, state zipCode`.
 * Missing parts are skipped and separators collapse so there are never dangling
 * commas or dashes.
 *
 * Returns `null` when the input is `null`, empty, invalid JSON, or parses to an
 * object with no usable fields — the caller renders `'-'` for `null`.
 */
export function formatAddress(json: string | null): string | null {
  if (json === null) return null;

  let parsed: ParsedAddress;
  try {
    parsed = JSON.parse(json) as ParsedAddress;
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object') return null;

  const street = cleanPart(parsed.street);
  const number = cleanPart(parsed.number);
  const complement = cleanPart(parsed.complement);
  const neighborhood = cleanPart(parsed.neighborhood);
  const city = cleanPart(parsed.city);
  const state = cleanPart(parsed.state);
  const zipCode = cleanPart(parsed.zipCode);

  const isPresent = (part: string | null): part is string => part !== null;

  // Group 1: street, number, complement — comma-separated.
  const streetGroup = [street, number, complement].filter(isPresent).join(', ');

  // Group 3: city, state zipCode — "city, state zipCode" (state and zip joined
  // by a space, prefixed with the city when present).
  const stateZip = [state, zipCode].filter(isPresent).join(' ');
  const cityGroup = [city, stateZip]
    .filter(isPresent)
    .filter((part) => part.length > 0)
    .join(', ');

  // Top-level groups (street block, neighborhood, city block) joined by " - ".
  const formatted = [streetGroup, neighborhood, cityGroup]
    .filter(isPresent)
    .filter((group) => group.length > 0)
    .join(' - ');

  return formatted.length > 0 ? formatted : null;
}
