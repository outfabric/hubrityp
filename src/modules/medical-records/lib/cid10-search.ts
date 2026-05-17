import cid10Raw from './cid10-data.json';

export type Cid10Result = {
  code: string;
  description: string;
};

type NormalizedEntry = {
  code: string;
  description: string;
  normalizedCode: string;
  normalizedDescription: string;
};

const DEFAULT_LIMIT = 20;

/**
 * Strips diacritical marks (accents) from a string.
 * Uses Unicode NFD decomposition followed by removal of combining marks.
 */
function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normalizes a string for comparison: lowercase + accent-stripped.
 */
function normalize(str: string): string {
  return stripAccents(str.toLowerCase());
}

// Lazy singleton: builds the normalized lookup array on first access.
let cachedEntries: NormalizedEntry[] | null = null;

function getEntries(): NormalizedEntry[] {
  if (cachedEntries === null) {
    cachedEntries = (cid10Raw as Cid10Result[]).map((entry) => ({
      code: entry.code,
      description: entry.description,
      normalizedCode: normalize(entry.code),
      normalizedDescription: normalize(entry.description),
    }));
  }
  return cachedEntries;
}

/**
 * Searches the CID-10 dataset by code prefix or description substring.
 *
 * - Accent-stripped, case-insensitive matching
 * - Code prefix match: entry.code starts with the query
 * - Description substring match: entry.description contains the query
 * - Sorted: exact code-prefix matches first, then alphabetical by code
 * - Sliced to limit (default 20)
 */
export function searchCid10(query: string, limit?: number): Cid10Result[] {
  const effectiveLimit = limit ?? DEFAULT_LIMIT;

  if (!query || query.trim().length === 0) {
    return [];
  }

  const normalizedQuery = normalize(query.trim());
  const entries = getEntries();

  const codeMatches: NormalizedEntry[] = [];
  const descriptionMatches: NormalizedEntry[] = [];

  for (const entry of entries) {
    const isCodeMatch = entry.normalizedCode.startsWith(normalizedQuery);
    const isDescriptionMatch = entry.normalizedDescription.includes(normalizedQuery);

    if (isCodeMatch) {
      codeMatches.push(entry);
    } else if (isDescriptionMatch) {
      descriptionMatches.push(entry);
    }
  }

  // Sort each group alphabetically by code
  codeMatches.sort((a, b) => a.code.localeCompare(b.code));
  descriptionMatches.sort((a, b) => a.code.localeCompare(b.code));

  // Code prefix matches first, then description matches
  const combined = [...codeMatches, ...descriptionMatches];

  return combined.slice(0, effectiveLimit).map((entry) => ({
    code: entry.code,
    description: entry.description,
  }));
}
