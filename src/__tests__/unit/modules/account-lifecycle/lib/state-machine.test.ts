import { describe, expect, it } from 'vitest';

import {
  type AccountStatus,
  type TransitionEvent,
  transitionStatus,
} from '@/modules/account-lifecycle/lib/state-machine';

// Exhaustive coverage of the transition table from the spec
// (Requirement: "transitionStatus helper is the single writer of `status`").
// Every valid pair is listed explicitly so adding/removing a row in the
// table forces a test edit. A `for ... of` over a generated cross product
// would hide spec drift.

describe('transitionStatus — valid transitions', () => {
  it('pending_verification + email_verified → pending_crp_validation', () => {
    expect(transitionStatus('pending_verification', 'email_verified')).toEqual({
      ok: true,
      status: 'pending_crp_validation',
    });
  });

  it('pending_crp_validation + crp_approved → active', () => {
    expect(transitionStatus('pending_crp_validation', 'crp_approved')).toEqual({
      ok: true,
      status: 'active',
    });
  });

  it('pending_crp_validation + crp_rejected → suspended', () => {
    expect(transitionStatus('pending_crp_validation', 'crp_rejected')).toEqual({
      ok: true,
      status: 'suspended',
    });
  });

  it('active + admin_suspend → suspended', () => {
    expect(transitionStatus('active', 'admin_suspend')).toEqual({
      ok: true,
      status: 'suspended',
    });
  });

  it('active + user_cancel → cancelled', () => {
    expect(transitionStatus('active', 'user_cancel')).toEqual({
      ok: true,
      status: 'cancelled',
    });
  });

  it('suspended + admin_reinstate → active', () => {
    expect(transitionStatus('suspended', 'admin_reinstate')).toEqual({
      ok: true,
      status: 'active',
    });
  });
});

describe('transitionStatus — invalid transitions', () => {
  // Sample invalid pairs from each origin status, covering the spec
  // scenario "Invalid transition is rejected" plus a few more that have
  // historically been bug-prone in similar state machines.
  const invalidPairs: Array<[AccountStatus, TransitionEvent]> = [
    // From `pending_verification`: only `email_verified` is valid; everything
    // else MUST be rejected (admin actions on an unverified account etc.).
    ['pending_verification', 'crp_approved'],
    ['pending_verification', 'admin_suspend'],
    ['pending_verification', 'user_cancel'],
    ['pending_verification', 'admin_reinstate'],

    // From `pending_crp_validation`: only `crp_approved` / `crp_rejected`.
    ['pending_crp_validation', 'email_verified'],
    ['pending_crp_validation', 'admin_suspend'],
    ['pending_crp_validation', 'user_cancel'],

    // From `active`: only admin_suspend / user_cancel.
    ['active', 'email_verified'],
    ['active', 'crp_approved'],
    ['active', 'crp_rejected'],
    ['active', 'admin_reinstate'],

    // From `suspended`: only admin_reinstate.
    ['suspended', 'email_verified'],
    ['suspended', 'crp_approved'],
    ['suspended', 'admin_suspend'],
    ['suspended', 'user_cancel'],

    // From `cancelled`: terminal — no event is valid.
    ['cancelled', 'email_verified'],
    ['cancelled', 'crp_approved'],
    ['cancelled', 'crp_rejected'],
    ['cancelled', 'admin_suspend'],
    ['cancelled', 'user_cancel'],
    ['cancelled', 'admin_reinstate'],
  ];

  it.each(invalidPairs)('rejects (%s, %s)', (from, event) => {
    expect(transitionStatus(from, event)).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
  });

  it('explicitly covers the spec scenario `cancelled + email_verified`', () => {
    expect(transitionStatus('cancelled', 'email_verified')).toEqual({
      ok: false,
      error: 'invalid_transition',
    });
  });
});
