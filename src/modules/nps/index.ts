// Public API of the `nps` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/nps`, never from
// internal paths like `@/modules/nps/server/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level — so it can re-export pure lib (Zod schema, eligibility helpers) next to
// the Server Action implementation without turning the schema/type re-exports
// into RPC stubs.

// ---- Zod schema + inferred type ----------------------------------------------
export { npsAnswerSchema, type NpsAnswer } from './lib/schemas';

// ---- Pure eligibility / classification helpers -------------------------------
export {
  isDetractor,
  isEligibleForNps,
  NPS_ELIGIBILITY_DAYS,
  type NpsEligibilityInput,
} from './lib/schemas';

// ---- Inngest event contract (consumed by the detractor-email function) -------
export {
  detractorSubmittedEventSchema,
  NPS_EVENTS,
  type DetractorSubmittedEvent,
} from './inngest/events';

// ---- Server Action implementation --------------------------------------------
// Session-scoped, server-authoritative write. Authorization is `auth.uid()`
// only; any client-supplied user id is ignored (IDOR-safe). RLS is the backstop.
export { submitNpsImpl, type SubmitNpsInput, type SubmitNpsResult } from './server/submit-nps';

// ---- Server read: day-7 eligibility ------------------------------------------
// Owner-scoped (getUser()), fail-closed. Consumed by the (app) layout to decide
// whether to mount the NPS modal.
export { getNpsEligibility } from './server/get-eligibility';
export { getNpsHasResponded } from './server/get-has-responded';

// ---- UI components -----------------------------------------------------------
// Client leaves. They receive Server Action callbacks + a server-computed
// eligibility prop; they never reach into the DB or call the action directly.
export { NpsModal, type NpsModalProps } from './components/nps-modal';
export { NpsForm, type NpsFormProps } from './components/nps-form';
