import { describe, expect, it } from 'vitest';

import { canTransition, ProfileStatus } from '@/modules/registration/lib/profile-status';

/**
 * Allowed transitions per design.md D2:
 *
 *   pending_verification    → pending_crp_validation
 *   pending_crp_validation  → active
 *   active                  → suspended
 *   *                       → cancelled  (any non-cancelled state)
 *
 * `cancelled` is terminal; self-loops are always disallowed.
 */
const ALLOWED_PAIRS: ReadonlyArray<readonly [ProfileStatus, ProfileStatus]> = [
  [ProfileStatus.PendingVerification, ProfileStatus.PendingCrpValidation],
  [ProfileStatus.PendingCrpValidation, ProfileStatus.Active],
  [ProfileStatus.Active, ProfileStatus.Suspended],
  [ProfileStatus.PendingVerification, ProfileStatus.Cancelled],
  [ProfileStatus.PendingCrpValidation, ProfileStatus.Cancelled],
  [ProfileStatus.Active, ProfileStatus.Cancelled],
  [ProfileStatus.Suspended, ProfileStatus.Cancelled],
];

const ALL_STATUSES: ReadonlyArray<ProfileStatus> = [
  ProfileStatus.PendingVerification,
  ProfileStatus.PendingCrpValidation,
  ProfileStatus.Active,
  ProfileStatus.Suspended,
  ProfileStatus.Cancelled,
];

const isAllowed = (from: ProfileStatus, to: ProfileStatus): boolean =>
  ALLOWED_PAIRS.some(([f, t]) => f === from && t === to);

describe('ProfileStatus enum', () => {
  it('exposes the five expected snake-cased values', () => {
    expect(ProfileStatus.PendingVerification).toBe('pending_verification');
    expect(ProfileStatus.PendingCrpValidation).toBe('pending_crp_validation');
    expect(ProfileStatus.Active).toBe('active');
    expect(ProfileStatus.Suspended).toBe('suspended');
    expect(ProfileStatus.Cancelled).toBe('cancelled');
  });
});

describe('canTransition — happy paths', () => {
  it('allows pending_verification → pending_crp_validation', () => {
    expect(
      canTransition(ProfileStatus.PendingVerification, ProfileStatus.PendingCrpValidation),
    ).toBe(true);
  });

  it('allows pending_crp_validation → active', () => {
    expect(canTransition(ProfileStatus.PendingCrpValidation, ProfileStatus.Active)).toBe(true);
  });

  it('allows active → suspended', () => {
    expect(canTransition(ProfileStatus.Active, ProfileStatus.Suspended)).toBe(true);
  });

  it('allows any non-cancelled status → cancelled', () => {
    expect(canTransition(ProfileStatus.PendingVerification, ProfileStatus.Cancelled)).toBe(true);
    expect(canTransition(ProfileStatus.PendingCrpValidation, ProfileStatus.Cancelled)).toBe(true);
    expect(canTransition(ProfileStatus.Active, ProfileStatus.Cancelled)).toBe(true);
    expect(canTransition(ProfileStatus.Suspended, ProfileStatus.Cancelled)).toBe(true);
  });
});

describe('canTransition — disallowed paths', () => {
  it('rejects every self-loop', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status), `${status} → ${status} must be rejected`).toBe(false);
    }
  });

  it('treats cancelled as terminal — no edge leaves cancelled', () => {
    for (const to of ALL_STATUSES) {
      if (to === ProfileStatus.Cancelled) continue;
      expect(
        canTransition(ProfileStatus.Cancelled, to),
        `cancelled → ${to} must be rejected`,
      ).toBe(false);
    }
  });

  it('rejects skip-step transitions', () => {
    expect(canTransition(ProfileStatus.PendingVerification, ProfileStatus.Active)).toBe(false);
    expect(canTransition(ProfileStatus.PendingVerification, ProfileStatus.Suspended)).toBe(false);
    expect(canTransition(ProfileStatus.PendingCrpValidation, ProfileStatus.Suspended)).toBe(false);
  });

  it('rejects reverse edges along the happy path', () => {
    expect(
      canTransition(ProfileStatus.PendingCrpValidation, ProfileStatus.PendingVerification),
    ).toBe(false);
    expect(canTransition(ProfileStatus.Active, ProfileStatus.PendingCrpValidation)).toBe(false);
    expect(canTransition(ProfileStatus.Active, ProfileStatus.PendingVerification)).toBe(false);
    expect(canTransition(ProfileStatus.Suspended, ProfileStatus.Active)).toBe(false);
    expect(canTransition(ProfileStatus.Suspended, ProfileStatus.PendingCrpValidation)).toBe(false);
    expect(canTransition(ProfileStatus.Suspended, ProfileStatus.PendingVerification)).toBe(false);
  });
});

describe('canTransition — exhaustive 5x5 truth table', () => {
  it.each(
    ALL_STATUSES.flatMap((from) =>
      ALL_STATUSES.map((to) => ({ from, to, expected: isAllowed(from, to) })),
    ),
  )('canTransition($from, $to) === $expected', ({ from, to, expected }) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});
