/**
 * Session status state machine — pure module.
 *
 * Defines the five lifecycle states a session can be in, the valid
 * transitions between them, and the UI actions available for each state.
 *
 * No DB access here: Server Actions and the DB trigger are expected to call
 * `isValidTransition(...)` before applying any status change so invalid
 * edges are rejected at the application layer regardless of who initiated
 * the change.
 */

import { isSessionLocked } from './session-lock';

// ---------------------------------------------------------------------------
// Branded union type
// ---------------------------------------------------------------------------

/** Snake-cased status values stored in `sessions.status`. */
export const SESSION_STATUSES = ['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

type TransitionKey = `${SessionStatus}->${SessionStatus}`;

/**
 * Allowed status transitions (per design.md Decision 1):
 *
 *   scheduled  → confirmed   (patient confirms attendance)
 *   scheduled  → cancelled   (psychologist or patient cancels)
 *   scheduled  → done        (psychologist marks as completed)
 *   scheduled  → no_show     (psychologist marks as no-show)
 *   confirmed  → cancelled   (cancellation after confirmation)
 *   confirmed  → done        (completed after confirmation)
 *   confirmed  → no_show     (no-show after confirmation)
 *   cancelled  → scheduled   (reactivate a cancelled session)
 *   done       → —           (immutable after 7 days)
 *   no_show    → —           (terminal)
 */
export const VALID_TRANSITIONS: ReadonlySet<TransitionKey> = new Set<TransitionKey>([
  'scheduled->confirmed',
  'scheduled->cancelled',
  'scheduled->done',
  'scheduled->no_show',
  'confirmed->cancelled',
  'confirmed->done',
  'confirmed->no_show',
  'cancelled->scheduled',
]);

/**
 * Returns `true` iff `from → to` is an allowed transition.
 * Self-loops always return `false`.
 */
export function isValidTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (from === to) return false;
  return VALID_TRANSITIONS.has(`${from}->${to}`);
}

// ---------------------------------------------------------------------------
// Available UI actions
// ---------------------------------------------------------------------------

/** Discriminated union of actions the UI can render for a session. */
export type Action =
  | { type: 'confirm'; label: 'Confirmar presença' }
  | { type: 'reschedule'; label: 'Remarcar' }
  | { type: 'cancel'; label: 'Cancelar sessão' }
  | { type: 'mark_done'; label: 'Marcar como realizada' }
  | { type: 'mark_no_show'; label: 'Marcar como falta' }
  | { type: 'view_record'; label: 'Ver prontuário desta sessão' }
  | { type: 'add_payment'; label: 'Adicionar pagamento' }
  | { type: 'reactivate'; label: 'Reativar' }
  | { type: 'hard_delete'; label: 'Excluir definitivamente' }
  | { type: 'charge_no_show'; label: 'Cobrar falta' };

/**
 * Returns the list of UI actions for a given session state.
 *
 * The `session` parameter provides the fields needed to evaluate
 * time-based rules (7-day lock on `done`) and soft-delete state.
 */
export function getAvailableActions(
  status: SessionStatus,
  session: { updatedAt: Date; deletedAt: Date | null },
): Action[] {
  switch (status) {
    case 'scheduled':
      return [
        { type: 'confirm', label: 'Confirmar presença' },
        { type: 'reschedule', label: 'Remarcar' },
        { type: 'cancel', label: 'Cancelar sessão' },
        { type: 'mark_done', label: 'Marcar como realizada' },
        { type: 'mark_no_show', label: 'Marcar como falta' },
      ];

    case 'confirmed':
      return [
        { type: 'reschedule', label: 'Remarcar' },
        { type: 'cancel', label: 'Cancelar sessão' },
        { type: 'mark_done', label: 'Marcar como realizada' },
        { type: 'mark_no_show', label: 'Marcar como falta' },
      ];

    case 'done': {
      const locked = isSessionLocked({ status, updatedAt: session.updatedAt });
      // View-only link is always available; add_payment is locked after 7 days.
      const actions: Action[] = [{ type: 'view_record', label: 'Ver prontuário desta sessão' }];
      if (!locked) {
        actions.push({ type: 'add_payment', label: 'Adicionar pagamento' });
      }
      return actions;
    }

    case 'cancelled':
      return [
        { type: 'reactivate', label: 'Reativar' },
        { type: 'hard_delete', label: 'Excluir definitivamente' },
      ];

    case 'no_show':
      return [{ type: 'charge_no_show', label: 'Cobrar falta' }];

    default: {
      // Exhaustive check — ensures the compiler flags if a new status is added
      // but not handled here.
      status satisfies never;
      return [];
    }
  }
}
