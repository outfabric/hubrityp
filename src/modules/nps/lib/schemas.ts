/**
 * Zod schemas and pure eligibility/classification helpers for the NPS module.
 *
 * Pure logic only — no Node-only, DB, or Supabase imports. This file is the
 * single source of truth for the NPS answer shape (reused from the
 * onboarding-data-model change) plus the two deterministic predicates the rest
 * of the module relies on: detractor classification and day-7 eligibility.
 */

import type { z } from 'zod';

import { npsAnswerSchema as onboardingNpsAnswerSchema } from '@/modules/onboarding';

/**
 * Validates an NPS answer submitted by a psychologist.
 *
 * Re-exported from `@/modules/onboarding` so the NPS module owns a stable,
 * self-contained surface (consumers import from `@/modules/nps`, never reach
 * across into the onboarding internals). `score` is an integer 0–10; `feedback`
 * is optional free text capped at 2000 characters.
 *
 * NOTE: `feedback` may contain incidental PII — it is owner-scoped via the
 * `auth.uid()`-bounded write and MUST NEVER be logged.
 */
export const npsAnswerSchema = onboardingNpsAnswerSchema;

export type NpsAnswer = z.infer<typeof npsAnswerSchema>;

/**
 * Number of full days the user must have had an account (since first
 * authenticated access) before the NPS survey becomes eligible.
 */
export const NPS_ELIGIBILITY_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True when the score classifies the responder as a *detractor* on the NPS
 * scale (0–6 inclusive). Promoters are 9–10 and passives are 7–8; only
 * detractors trigger the follow-up email.
 *
 * The score is assumed to already be a validated 0–10 integer (see
 * {@link npsAnswerSchema}); callers that hold a raw number should validate
 * first.
 */
export function isDetractor(score: number): boolean {
  return score <= 6;
}

/**
 * Inputs for {@link isEligibleForNps}. `now` is injected (not read from the
 * clock) so the predicate stays pure and deterministically testable.
 */
export interface NpsEligibilityInput {
  /** When the user first accessed the authenticated app, or null if never. */
  firstAccessAt: Date | null;
  /** When the user submitted (or dismissed) the survey, or null if not yet. */
  npsRespondedAt: Date | null;
  /** The reference instant ("now") to evaluate eligibility against. */
  now: Date;
}

/**
 * True when the NPS survey should be offered to the user.
 *
 * Eligibility requires BOTH:
 *   1. The user has not yet responded (`npsRespondedAt IS NULL`) — submission
 *      and dismissal both stamp this column, so the survey is shown at most once.
 *   2. At least {@link NPS_ELIGIBILITY_DAYS} full days have elapsed since
 *      `firstAccessAt`. A user who has never accessed the app
 *      (`firstAccessAt === null`) is never eligible.
 *
 * The trigger is "first eligible app open at or after 7×24h from first access",
 * derived server-side from `first_access_at` — never from `localStorage`.
 */
export function isEligibleForNps({
  firstAccessAt,
  npsRespondedAt,
  now,
}: NpsEligibilityInput): boolean {
  if (npsRespondedAt !== null) return false;
  if (firstAccessAt === null) return false;

  const elapsedMs = now.getTime() - firstAccessAt.getTime();
  return elapsedMs >= NPS_ELIGIBILITY_DAYS * MS_PER_DAY;
}
