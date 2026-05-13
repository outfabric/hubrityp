/**
 * Template rendering — pure function that substitutes `{variable}`
 * placeholders in a template body with concrete values.
 *
 * The algorithm is intentionally simple:
 *   1. Extract all `{name}` occurrences via regex.
 *   2. For each found placeholder, verify it exists in the supplied vars.
 *      If missing, throw with the name of the unresolved variable.
 *   3. Replace every `{name}` with the corresponding value from vars.
 *   4. Return the final string.
 *
 * Extra keys in `vars` that don't appear in the body are silently
 * ignored. A body with no placeholders is returned as-is.
 *
 * Substitution is single-pass — literal `{` characters inside values
 * do NOT trigger re-substitution, ensuring idempotency.
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class MissingTemplateVariableError extends Error {
  public readonly variableName: string;

  constructor(variableName: string) {
    super(`Missing template variable: {${variableName}}`);
    this.name = 'MissingTemplateVariableError';
    this.variableName = variableName;
  }
}

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

/** Matches `{word_chars}` placeholders. */
const VARIABLE_PATTERN = /\{(\w+)\}/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a template body by replacing `{variable}` placeholders with
 * values from `vars`.
 *
 * @throws {MissingTemplateVariableError} if a placeholder in `body`
 *   has no corresponding key in `vars`.
 */
export function renderTemplate({
  body,
  vars,
}: {
  body: string;
  vars: Record<string, string>;
}): string {
  // Step 1: extract all unique variable names from the body.
  const matches = body.matchAll(VARIABLE_PATTERN);
  const requiredVars = new Set<string>();
  for (const match of matches) {
    // Capture group 1 is guaranteed by the regex — safe assertion.
    requiredVars.add(match[1]!);
  }

  // Step 2: verify every required variable is present in vars.
  for (const name of requiredVars) {
    if (!(name in vars)) {
      throw new MissingTemplateVariableError(name);
    }
  }

  // Step 3: single-pass replacement.
  // Every name that reaches here was validated in step 2 — safe assertion.
  // We use a fresh regex literal (no stale lastIndex) for the replace.
  return body.replace(/\{(\w+)\}/g, (_match, name: string) => vars[name]!);
}
