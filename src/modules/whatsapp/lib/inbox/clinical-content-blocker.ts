/**
 * Clinical-content blocker for outbound WhatsApp messages.
 *
 * Prevents psychologists from accidentally sending clinical content
 * (diagnoses, session notes, test scores) through an unencrypted
 * messaging channel. Uses heuristic pattern matching — false positives
 * are preferred over false negatives (err on the side of caution).
 *
 * @see Decision 4 in design.md — "Clinical-content blocker: heuristic
 * pattern matching"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClinicalContentResult {
  /** Whether the text is allowed to be sent. */
  allowed: boolean;
  /** Human-readable reason when blocked (undefined when allowed). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Pattern categories
// ---------------------------------------------------------------------------

/**
 * Each category defines a label (used in the reason string) and an
 * array of regex patterns. All regexes are case-insensitive and
 * accent-normalized.
 */
interface PatternCategory {
  label: string;
  patterns: RegExp[];
}

const PATTERN_CATEGORIES: PatternCategory[] = [
  {
    label: 'Código CID-10 detectado',
    patterns: [
      // F00-F99 — Mental and behavioural disorders chapter
      /\bF\d{2}(?:\.\d{1,2})?\b/i,
    ],
  },
  {
    label: 'Referência ao DSM-5 detectada',
    patterns: [/\bDSM[-\s]?5\b/i, /\bDSM[-\s]?IV\b/i, /\bDSM[-\s]?V\b/i],
  },
  {
    label: 'Termo diagnóstico detectado',
    patterns: [
      /\btranstorno\b/i,
      /\bdepressao\s+maior\b/i,
      /\bdepressão\s+maior\b/i,
      /\bansiedade\s+generalizada\b/i,
      /\besquizofrenia\b/i,
    ],
  },
  {
    label: 'Conteúdo de sessão clínica detectado',
    patterns: [
      /\bevolu(?:ç|c)(?:ã|a)o\s+da\s+sess(?:ã|a)o\b/i,
      /\bsess(?:ã|a)o\s+de\s+hoje\b/i,
      /\bconte(?:ú|u)do\s+da\s+sess(?:ã|a)o\b/i,
      /\brelato\s+do\s+paciente\b/i,
    ],
  },
  {
    label: 'Referência psicométrica detectada',
    patterns: [
      /\bscore\b/i,
      /\bpercentil\b/i,
      /\bescala\b/i,
      /\bresultado\s+do\s+teste\b/i,
      /\bBDI\b/,
      /\bBAI\b/,
      /\bWISC\b/,
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips diacritics (accents) from a string so that pattern matching
 * works regardless of whether the user typed accented characters.
 */
function normalizeAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether `text` contains clinical content that should NOT be
 * sent through WhatsApp.
 *
 * @param text - The outbound message text to validate.
 * @returns `{ allowed: true }` when safe, or
 *          `{ allowed: false, reason: "..." }` when blocked.
 */
export function checkClinicalContent(text: string): ClinicalContentResult {
  // Normalize accents in the input so accented and unaccented forms match.
  const normalized = normalizeAccents(text);

  for (const category of PATTERN_CATEGORIES) {
    for (const pattern of category.patterns) {
      // Test against both the original (for patterns that explicitly
      // match accented chars like ç/ã) and the normalized form.
      if (pattern.test(text) || pattern.test(normalized)) {
        return {
          allowed: false,
          reason: category.label,
        };
      }
    }
  }

  return { allowed: true };
}
