/**
 * One-way pseudonymization of patient names in a transcript.
 *
 * Replaces occurrences of the patient's first name and every token of their
 * full name (longer than 2 characters) with the word "Paciente". The match
 * is case-insensitive and respects word boundaries so short substrings
 * (e.g. "Lu" inside "Luz") are not replaced.
 *
 * This function is PURE: no logging, no I/O, no side effects.
 */
export function pseudonymizeTranscript({
  patientFirstName,
  patientFullName,
  transcript,
}: {
  patientFirstName: string;
  patientFullName: string;
  transcript: string;
}): string {
  // Split the full name into individual tokens and keep only those with
  // length > 2 to avoid matching common prepositions (de, da, do, etc.)
  const fullNameTokens = patientFullName.split(/\s+/).filter((token) => token.length > 2);

  // Build the list of substitution targets: first name + all qualifying tokens.
  // Use a Set to avoid duplicates (first name is often a token in full name).
  const targets = new Set<string>();
  if (patientFirstName.length > 2) {
    targets.add(patientFirstName);
  }
  for (const token of fullNameTokens) {
    targets.add(token);
  }

  if (targets.size === 0) {
    return transcript;
  }

  // Escape regex special characters in each target, then join with alternation.
  // Sort by length descending so longer matches are preferred (e.g. "Maria Clara"
  // tokens: "Maria", "Clara" — order doesn't matter for single tokens, but if
  // the full name itself were added, longer first prevents partial matches).
  const escaped = [...targets]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

  return transcript.replace(pattern, 'Paciente');
}
