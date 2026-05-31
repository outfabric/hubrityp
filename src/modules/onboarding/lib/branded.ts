/**
 * Branded types and value unions for the onboarding module.
 *
 * Branded types make illegal states unrepresentable at the type level: an
 * `NpsScore` can only be produced through {@link toNpsScore}, which enforces the
 * 0–10 integer domain at runtime. This prevents arbitrary `number`s from leaking
 * into the NPS pipeline without validation.
 */

const npsScoreBrand = Symbol('NpsScore');

/**
 * A Net Promoter Score: an integer in the inclusive range 0–10.
 *
 * Construct exclusively via {@link toNpsScore}; the brand cannot be forged from a
 * plain `number`.
 */
export type NpsScore = number & { readonly [npsScoreBrand]: true };

/**
 * Smart constructor for {@link NpsScore}.
 *
 * @throws {RangeError} when `n` is not an integer or falls outside 0–10.
 */
export function toNpsScore(n: number): NpsScore {
  if (!Number.isInteger(n) || n < 0 || n > 10) {
    throw new RangeError(`NpsScore must be an integer between 0 and 10, got ${n}`);
  }
  return n as NpsScore;
}

/**
 * The ordered steps of the onboarding wizard.
 *
 * `done` is the terminal state once the psychologist has completed onboarding.
 */
export type OnboardingStep = 'welcome' | 'profile' | 'location' | 'patients' | 'done';
