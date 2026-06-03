/**
 * Result shapes for the dashboard aggregate read queries.
 *
 * These types are the dashboard module's public contract (re-exported from the
 * barrel). They deliberately carry only what the four operational sections need
 * to render — counts, deep-link targets, and the minimal session display fields
 * — and never raw clinical content (evolution text, AI notes, anamnesis, etc.).
 *
 * Every query returns a discriminated union on `ok` so the page can render an
 * unauthenticated/empty state without inspecting an out-of-band error channel.
 */

// ---------------------------------------------------------------------------
// getTodaySessions
// ---------------------------------------------------------------------------

export type SessionModality = 'in_person' | 'online';

export type SessionStatus = 'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show';

/**
 * One session in the "Hoje" list. `patientName` is the only PII field and is
 * required for the day view; it is owner-scoped (the row belongs to the caller)
 * so no cross-tenant leak is possible. `openHref` is computed server-side from
 * the session's modality (never from client input), so it is safe to render as
 * a link target without an open-redirect guard.
 */
export interface TodaySessionView {
  sessionId: string;
  patientId: string | null;
  patientName: string | null;
  /** UTC instant; formatted to America/Sao_Paulo in the presentation layer. */
  startAt: Date;
  modality: SessionModality | null;
  status: SessionStatus;
  /**
   * Server-computed target for the "Abrir sessão" CTA:
   *   - `online`    → `/sessao/{sessionId}/video`
   *   - `in_person` → `/pacientes/{patientId}`
   * `null` when neither can be resolved (e.g. missing modality/patient).
   */
  openHref: string | null;
}

export interface TodaySessionsResult {
  ok: true;
  /** The next upcoming session today (start >= now), or null if none remain. */
  next: TodaySessionView | null;
  /** Every session today, ordered by start time ascending. */
  sessions: TodaySessionView[];
}

// ---------------------------------------------------------------------------
// getPendencias
// ---------------------------------------------------------------------------

/**
 * MVP-allowlisted pendências. Counts + deep-link targets only — no clinical
 * text. Post-MVP types (Receita Saúde, cobranças, WhatsApp) are intentionally
 * never queried, so they cannot leak into this result.
 */
export interface PendenciasResult {
  ok: true;
  /** `done` sessions older than 7 days with no evolution recorded. */
  overdueEvolutionsCount: number;
  overdueEvolutionsHref: string;
  /** Patients whose `consent_signed_at` is NULL. */
  patientsMissingConsentCount: number;
  patientsMissingConsentHref: string;
  /** AI transcription notes in the `ready` state (awaiting human review). */
  aiNotesAwaitingReviewCount: number;
  aiNotesAwaitingReviewHref: string;
}

// ---------------------------------------------------------------------------
// getWeeklySummary
// ---------------------------------------------------------------------------

export interface WeeklySummaryResult {
  ok: true;
  sessionsDoneThisWeek: number;
  sessionsScheduledThisWeek: number;
  /**
   * No-show rate as an integer percentage (0–100), or `null` when the sample
   * is below the meaningful-rate threshold. Owner-only — never a benchmark.
   */
  noShowRatePercent: number | null;
  newPatientsThisMonth: number;
  evolutionsThisWeek: number;
}

// ---------------------------------------------------------------------------
// Shared unauthorized variant
// ---------------------------------------------------------------------------

export interface UnauthorizedResult {
  ok: false;
  code: 'UNAUTHORIZED';
}
