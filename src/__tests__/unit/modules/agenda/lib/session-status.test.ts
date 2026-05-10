import { describe, expect, it } from 'vitest';

import {
  type Action,
  type SessionStatus,
  VALID_TRANSITIONS,
  getAvailableActions,
  isValidTransition,
} from '@/modules/agenda/lib/session-status';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal session object for `getAvailableActions`. */
function makeSession(overrides: { updatedAt?: Date; deletedAt?: Date | null } = {}) {
  return {
    updatedAt: overrides.updatedAt ?? new Date(),
    deletedAt: overrides.deletedAt ?? null,
  };
}

/** Extract `type` values from an Action array for concise assertions. */
function actionTypes(actions: Action[]): string[] {
  return actions.map((a) => a.type);
}

// ---------------------------------------------------------------------------
// isValidTransition — valid transitions
// ---------------------------------------------------------------------------

describe('isValidTransition — valid transitions', () => {
  const validCases: [SessionStatus, SessionStatus][] = [
    ['scheduled', 'confirmed'],
    ['scheduled', 'cancelled'],
    ['scheduled', 'done'],
    ['scheduled', 'no_show'],
    ['confirmed', 'cancelled'],
    ['confirmed', 'done'],
    ['confirmed', 'no_show'],
    ['cancelled', 'scheduled'],
  ];

  it.each(validCases)('%s → %s should be valid', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it('VALID_TRANSITIONS set has exactly 8 entries', () => {
    expect(VALID_TRANSITIONS.size).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// isValidTransition — invalid transitions
// ---------------------------------------------------------------------------

describe('isValidTransition — invalid transitions', () => {
  const invalidCases: [SessionStatus, SessionStatus][] = [
    // done is terminal (no outbound transitions)
    ['done', 'scheduled'],
    ['done', 'confirmed'],
    ['done', 'cancelled'],
    ['done', 'no_show'],
    // no_show is terminal
    ['no_show', 'scheduled'],
    ['no_show', 'confirmed'],
    ['no_show', 'cancelled'],
    ['no_show', 'done'],
    // cancelled cannot go to confirmed/done/no_show
    ['cancelled', 'confirmed'],
    ['cancelled', 'done'],
    ['cancelled', 'no_show'],
    // confirmed cannot go back to scheduled
    ['confirmed', 'scheduled'],
    // scheduled cannot self-loop
    ['scheduled', 'scheduled'],
  ];

  it.each(invalidCases)('%s → %s should be invalid', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false);
  });

  it('self-loops are always invalid', () => {
    const statuses: SessionStatus[] = ['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'];
    for (const s of statuses) {
      expect(isValidTransition(s, s)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// getAvailableActions — per status
// ---------------------------------------------------------------------------

describe('getAvailableActions — scheduled', () => {
  it('returns confirm, reschedule, cancel, mark_done, mark_no_show', () => {
    const actions = getAvailableActions('scheduled', makeSession());
    expect(actionTypes(actions)).toEqual([
      'confirm',
      'reschedule',
      'cancel',
      'mark_done',
      'mark_no_show',
    ]);
  });

  it('actions have correct pt-BR labels', () => {
    const actions = getAvailableActions('scheduled', makeSession());
    const labels = actions.map((a) => a.label);
    expect(labels).toContain('Confirmar presença');
    expect(labels).toContain('Remarcar');
    expect(labels).toContain('Cancelar sessão');
    expect(labels).toContain('Marcar como realizada');
    expect(labels).toContain('Marcar como falta');
  });
});

describe('getAvailableActions — confirmed', () => {
  it('returns reschedule, cancel, mark_done, mark_no_show (no confirm)', () => {
    const actions = getAvailableActions('confirmed', makeSession());
    expect(actionTypes(actions)).toEqual(['reschedule', 'cancel', 'mark_done', 'mark_no_show']);
  });

  it('does not include confirm action', () => {
    const actions = getAvailableActions('confirmed', makeSession());
    expect(actionTypes(actions)).not.toContain('confirm');
  });
});

describe('getAvailableActions — done (within 7 days)', () => {
  it('returns view_record and add_payment', () => {
    const recentUpdate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
    const actions = getAvailableActions('done', makeSession({ updatedAt: recentUpdate }));
    expect(actionTypes(actions)).toEqual(['view_record', 'add_payment']);
  });
});

describe('getAvailableActions — done (after 7 days, locked)', () => {
  it('returns only view_record (add_payment locked)', () => {
    const oldUpdate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    const actions = getAvailableActions('done', makeSession({ updatedAt: oldUpdate }));
    expect(actionTypes(actions)).toEqual(['view_record']);
  });

  it('does not include add_payment', () => {
    const oldUpdate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const actions = getAvailableActions('done', makeSession({ updatedAt: oldUpdate }));
    expect(actionTypes(actions)).not.toContain('add_payment');
  });
});

describe('getAvailableActions — cancelled', () => {
  it('returns reactivate and hard_delete', () => {
    const actions = getAvailableActions('cancelled', makeSession());
    expect(actionTypes(actions)).toEqual(['reactivate', 'hard_delete']);
  });
});

describe('getAvailableActions — no_show', () => {
  it('returns charge_no_show', () => {
    const actions = getAvailableActions('no_show', makeSession());
    expect(actionTypes(actions)).toEqual(['charge_no_show']);
  });

  it('has exactly one action', () => {
    const actions = getAvailableActions('no_show', makeSession());
    expect(actions).toHaveLength(1);
  });
});
