// Public API of the `sessions` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/sessions`, never
// from internal paths like `@/modules/sessions/lib/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports Server Action implementations, pure helpers,
// and types; if it carried `'use server'`, every export would be transformed
// into an RPC stub by the Next.js compiler and the schema/type re-exports
// would break.

// ---- Server Actions (recurring sessions) ------------------------------------
export {
  createRecurringSessionImpl,
  type CreateRecurringSessionResult,
} from './server/create-recurring-session';
export {
  editRecurringSessionImpl,
  type EditRecurringSessionResult,
} from './server/edit-recurring-session';
export {
  cancelRecurringSessionImpl,
  type CancelRecurringSessionResult,
} from './server/cancel-recurring-session';

// ---- Server Actions (couple sessions) ---------------------------------------
export {
  createCoupleSessionImpl,
  type CreateCoupleSessionResult,
} from './server/create-couple-session';

// ---- Server Actions (late records) ------------------------------------------
export { createLateRecordImpl, type CreateLateRecordResult } from './server/create-late-record';

// ---- Zod Schemas ------------------------------------------------------------
export {
  recurrenceFormSchema,
  type RecurrenceFormInput,
  coupleSessionSchema,
  type CoupleSessionInput,
  lateRecordSchema,
  type LateRecordInput,
} from './lib/recurrence-schema';

// ---- Lib — recurrence instance generation -----------------------------------
export {
  generateRecurrenceInstances,
  MAX_MATERIALIZED_SESSIONS,
  type RecurrenceRule,
  type RecurrenceFrequency,
} from './lib/generate-recurrence-instances';

// ---- Lib — edit scope computation -------------------------------------------
export {
  computeEditScope,
  type EditScope,
  type SeriesSession,
  type EditScopeResult,
} from './lib/compute-edit-scope';

// ---- Components — edit scope dialog -----------------------------------------
export { EditScopeDialog, type EditScopeDialogProps } from './components/edit-scope-dialog';
