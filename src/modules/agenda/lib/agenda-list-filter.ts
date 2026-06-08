/**
 * Agenda list-filter allowlist parser — pure module.
 *
 * The agenda page accepts a `filtro` query-string parameter that switches the
 * default calendar into a focused list view (e.g. overdue evolutions). The set
 * of valid filters is a CLOSED allowlist: any value outside it — including the
 * empty string, an `undefined`, or an array (repeated query params) — resolves
 * to `null`, which the page treats as "no filter, render the default calendar".
 *
 * This parser is the trust boundary for the raw, attacker-controlled query
 * value. It is total (never throws — design D1, RF-12.03/RNF-12.05) so callers
 * can safely feed it `searchParams` without a try/catch.
 */

/** Closed allowlist of supported list filters. */
export const AGENDA_LIST_FILTERS = ['sem-evolucao'] as const;

/** A valid agenda list filter value. */
export type AgendaListFilter = (typeof AGENDA_LIST_FILTERS)[number];

/**
 * Resolves a raw `filtro` query value against the closed allowlist.
 *
 * Unknown/empty/array → `null` (default calendar). Never throws.
 */
export function resolveAgendaListFilter(
  raw: string | string[] | undefined,
): AgendaListFilter | null {
  return typeof raw === 'string' && (AGENDA_LIST_FILTERS as readonly string[]).includes(raw)
    ? (raw as AgendaListFilter)
    : null;
}
