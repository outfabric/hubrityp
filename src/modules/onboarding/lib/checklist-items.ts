// Pure model for the onboarding checklist shown on the dashboard.
//
// This file is intentionally framework-free (no React, no DB, no server-only):
// it is the single source of truth for *which* items exist, in *what order*
// they render, *which* are mandatory, and how the "X% complete" progress is
// computed. The server recompute (`recomputeChecklistImpl`) derives each item's
// done-state from authoritative data and persists it; the UI reads it back.
// Keeping the catalog + the percentage math here means both the server and the
// client agree on the model without importing each other.
//
// The seven items match the `onboarding-checklist` spec:
//   1. cadastro_completo          (email verified + CRP validated)
//   2. perfil_e_local             (>= 1 consultation location)
//   3. primeiro_paciente          (>= 1 active patient)
//   4. primeira_sessao            (>= 1 non-cancelled session)
//   5. primeira_evolucao          (>= 1 evolution)
//   6. primeiro_termo             (>= 1 patient with consent signed)
//   7. transcricao_ia  (BONUS)    (AI enabled AND >= 1 transcription started)
//
// Items 1-6 are mandatory and count toward 100%. Item 7 is a bonus: it can be
// pending while the checklist is still "100% complete", and completing it never
// changes the mandatory percentage (it is simply excluded from the math).

/**
 * Stable identifier for each checklist item. Used as the map key in
 * {@link ChecklistState} and persisted indirectly via the
 * `onboarding_checklist` boolean columns the server maps these to.
 */
export type ChecklistItemKey =
  | 'cadastro_completo'
  | 'perfil_e_local'
  | 'primeiro_paciente'
  | 'primeira_sessao'
  | 'primeira_evolucao'
  | 'primeiro_termo'
  | 'transcricao_ia';

/**
 * A single checklist item's static metadata (everything that does NOT depend on
 * the user's data). The done-state lives separately in {@link ChecklistState}.
 */
export interface ChecklistItem {
  /** Stable key — never localized, safe to persist / send to the client. */
  readonly key: ChecklistItemKey;
  /** pt-BR label rendered in the checklist UI. */
  readonly label: string;
  /**
   * Server-owned, static deep-link target for the item's CTA. These are fixed
   * app paths (never built from user input), so they are safe href values.
   */
  readonly actionTarget: string;
  /**
   * Whether the item counts toward the mandatory 100%. Exactly one item
   * (`transcricao_ia`) is a bonus (`mandatory: false`).
   */
  readonly mandatory: boolean;
}

/**
 * The ordered catalog of checklist items. Order is significant: it is the order
 * the UI renders them in, so it MUST stay stable. The first six are mandatory;
 * the seventh is the AI-transcription bonus.
 */
export const CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  {
    key: 'cadastro_completo',
    label: 'Concluir cadastro',
    actionTarget: '/configuracoes/conta',
    mandatory: true,
  },
  {
    key: 'perfil_e_local',
    label: 'Configurar perfil e local de atendimento',
    actionTarget: '/configuracoes/locais',
    mandatory: true,
  },
  {
    key: 'primeiro_paciente',
    label: 'Cadastrar seu primeiro paciente',
    actionTarget: '/pacientes',
    mandatory: true,
  },
  {
    key: 'primeira_sessao',
    label: 'Agendar sua primeira sessão',
    actionTarget: '/agenda',
    mandatory: true,
  },
  {
    key: 'primeira_evolucao',
    label: 'Registrar sua primeira evolução',
    actionTarget: '/pacientes',
    mandatory: true,
  },
  {
    key: 'primeiro_termo',
    label: 'Enviar seu primeiro termo de consentimento',
    actionTarget: '/pacientes',
    mandatory: true,
  },
  {
    key: 'transcricao_ia',
    label: 'Experimentar a transcrição com IA',
    actionTarget: '/configuracoes/ia',
    mandatory: false,
  },
] as const;

/**
 * The done-state of every checklist item, keyed by {@link ChecklistItemKey}.
 * `true` = the item is satisfied by the user's authoritative data. A complete
 * state has an entry for every key (the server always builds a full state).
 */
export type ChecklistState = Readonly<Record<ChecklistItemKey, boolean>>;

/**
 * Whether a single item is complete in the given state. A `true` entry means
 * the item is done; a missing/`false` entry means it is pending.
 */
export function isComplete(state: ChecklistState, key: ChecklistItemKey): boolean {
  return state[key] === true;
}

/**
 * The mandatory completion percentage (0-100, integer-rounded).
 *
 * Only the six mandatory items contribute: the bonus item (`transcricao_ia`) is
 * excluded entirely, so a user with all mandatory items done but the bonus
 * still pending is at 100%. Conversely, completing the bonus never moves this
 * number. Returns 100 in the degenerate case of zero mandatory items (cannot
 * happen with the current catalog, but keeps the function total).
 */
export function mandatoryCompletePct(state: ChecklistState): number {
  const mandatoryItems = CHECKLIST_ITEMS.filter((item) => item.mandatory);
  if (mandatoryItems.length === 0) {
    return 100;
  }

  const done = mandatoryItems.filter((item) => isComplete(state, item.key)).length;
  return Math.round((done / mandatoryItems.length) * 100);
}
