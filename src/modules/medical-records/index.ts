// Public API of the `medical-records` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/medical-records`,
// never from internal paths like `@/modules/medical-records/server/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports Server Action implementations, pure helpers,
// types, and Zod schemas; if it carried `'use server'`, every export would be
// transformed into an RPC stub by the Next.js compiler.

// ---- Server Actions (delegated to by route shells) --------------------------
export { createEvolutionImpl, type CreateEvolutionResult } from './server/create-evolution';
export { updateEvolutionImpl, type UpdateEvolutionResult } from './server/update-evolution';
export {
  getEvolutionsByPatientImpl,
  type GetEvolutionsByPatientResult,
  type EvolutionSummary,
} from './server/get-evolutions-by-patient';
export {
  getEvolutionDetailImpl,
  type GetEvolutionDetailResult,
  type EvolutionFull,
} from './server/get-evolution-detail';
export {
  listEvolutionVersionsImpl,
  type ListEvolutionVersionsResult,
} from './server/list-evolution-versions';
export { logProntuarioAccessImpl } from './server/log-prontuario-access';

// ---- Zod Schemas ------------------------------------------------------------
export {
  createEvolutionInputSchema,
  updateEvolutionInputSchema,
  CONTENT_SCHEMA_MAP,
  tccContentSchema,
  psicanaliseContentSchema,
  sistemicaContentSchema,
  abaContentSchema,
  livreContentSchema,
  customContentSchema,
  type CreateEvolutionInput,
  type UpdateEvolutionInput,
} from './lib/evolution-schemas';

// ---- Template Types ---------------------------------------------------------
export { TEMPLATE_TYPES, TEMPLATE_OPTIONS, type TemplateType } from './lib/template-types';

// ---- Immutability Helpers ---------------------------------------------------
export { isWithinEditWindow, shouldForceAddendum } from './lib/immutability-helpers';

// ---- Content Diff -----------------------------------------------------------
export { contentHasChanged } from './lib/content-diff';

// ---- Hypothesis Schemas -----------------------------------------------------
export {
  hypothesisStatusSchema,
  createHypothesisSchema,
  updateHypothesisSchema,
  updateHypothesisStatusSchema,
  type HypothesisStatus,
  type CreateHypothesisInput,
  type UpdateHypothesisInput,
  type UpdateHypothesisStatusInput,
} from './lib/schemas/hypothesis';
