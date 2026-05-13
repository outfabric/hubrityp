/**
 * Risk-keyword detection for inbound WhatsApp messages.
 *
 * Uses a curated PT-BR dictionary of phrases associated with suicidal
 * ideation and self-harm. Detection is regex-based (case-insensitive,
 * accent-normalized) — NOT ML — to keep the function pure, fast, and
 * auditable.
 *
 * False-positive mitigation: an exclusion list removes common idiomatic
 * expressions (e.g. "matar saudade") before scanning for risk keywords.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskDetectionResult {
  /** Whether at least one risk keyword was found. */
  flagged: boolean;
  /** All matched keywords (empty when `flagged` is false). */
  keywords: string[];
}

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

/**
 * Each entry is a canonical keyword string. The regex builder normalizes
 * accents so both "suicídio" and "suicidio" match.
 */
const RISK_KEYWORDS = [
  'suicídio',
  'suicidio',
  'suicidar',
  'me matar',
  'acabar com tudo',
  'autolesão',
  'autolesao',
  'me cortar',
  'sumir pra sempre',
  'não quero mais viver',
  'nao quero mais viver',
  'quero morrer',
  'tirar minha vida',
  'desistir de tudo',
  'não aguento mais',
  'nao aguento mais',
] as const;

/**
 * Idiomatic expressions that contain risk keywords but are NOT indicators
 * of risk. These are stripped from the input before scanning.
 */
const FALSE_POSITIVE_PHRASES = [
  'matar saudade',
  'morrer de rir',
  'morrer de vontade',
  'matar a fome',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips diacritics (accents) from a string so that "suicídio" normalizes
 * to "suicidio", enabling accent-insensitive matching.
 */
function normalizeAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Escapes special regex characters in a literal string so it can be
 * safely interpolated into a `RegExp`.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a word-boundary-aware, case-insensitive regex for a keyword.
 * Uses `\b` for word boundaries so partial matches inside unrelated
 * words are avoided.
 */
function buildKeywordRegex(keyword: string): RegExp {
  const normalized = normalizeAccents(keyword);
  return new RegExp(`\\b${escapeRegex(normalized)}\\b`, 'i');
}

/**
 * Removes known false-positive phrases from the input before risk
 * scanning, preventing idiomatic expressions from triggering alerts.
 */
function removeFalsePositives(text: string): string {
  let cleaned = text;
  for (const phrase of FALSE_POSITIVE_PHRASES) {
    const regex = new RegExp(`\\b${escapeRegex(normalizeAccents(phrase))}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// De-duplicate canonical forms
// ---------------------------------------------------------------------------

/**
 * We keep both accented and unaccented forms in RISK_KEYWORDS for
 * clarity, but after normalization they collapse to the same string.
 * Build a unique set to avoid reporting the same keyword twice.
 */
const UNIQUE_PATTERNS: Array<{ canonical: string; regex: RegExp }> = [];

const seenNormalized = new Set<string>();
for (const kw of RISK_KEYWORDS) {
  const normalized = normalizeAccents(kw).toLowerCase();
  if (!seenNormalized.has(normalized)) {
    seenNormalized.add(normalized);
    UNIQUE_PATTERNS.push({ canonical: normalized, regex: buildKeywordRegex(kw) });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scans `body` for curated risk keywords associated with suicidal
 * ideation or self-harm.
 *
 * @param body - Raw message text (any casing, with or without accents).
 * @returns `flagged: true` with an array of matched keywords, or
 *          `flagged: false` with an empty array.
 */
export function detectRiskKeywords(body: string): RiskDetectionResult {
  // 1. Normalize accents in the input for accent-insensitive comparison.
  const normalized = normalizeAccents(body);

  // 2. Strip false-positive phrases before scanning.
  const cleaned = removeFalsePositives(normalized);

  // 3. Scan for each unique keyword pattern.
  const matched: string[] = [];
  for (const { canonical, regex } of UNIQUE_PATTERNS) {
    if (regex.test(cleaned)) {
      matched.push(canonical);
    }
  }

  return {
    flagged: matched.length > 0,
    keywords: matched,
  };
}
