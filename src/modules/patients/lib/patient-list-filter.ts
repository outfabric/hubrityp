// Closed allowlist parser for the patient list `filtro` query param.
//
// The patient list page reads a `filtro` search param to narrow the listing.
// `searchParams` values are attacker-controlled (anyone can craft the URL),
// so we never trust the raw value: it is resolved against a fixed allowlist
// and anything outside that set degrades to `null` (no filter applied).
//
// Mirrors the allowlist pattern from `fix-pendencia-ai-notes-deeplink`.
// Design ref: design.md D1 / RF-12.03 / RNF-12.05.

export const PATIENT_LIST_FILTERS = ['sem-consentimento'] as const;
export type PatientListFilter = (typeof PATIENT_LIST_FILTERS)[number];

/** Closed allowlist. Unknown/empty/array → null (no filter). Never throws. */
export function resolvePatientListFilter(
  raw: string | string[] | undefined,
): PatientListFilter | null {
  return typeof raw === 'string' && (PATIENT_LIST_FILTERS as readonly string[]).includes(raw)
    ? (raw as PatientListFilter)
    : null;
}
