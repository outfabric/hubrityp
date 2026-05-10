// Public API of the `sessions` module — CLIENT-SAFE barrel.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/sessions`, never
// from internal paths like `@/modules/sessions/lib/...`.
//
// IMPORTANT: Server Action implementations (`*Impl` functions) are NOT
// re-exported here because they `import 'server-only'`, which would cause a
// fatal build error when a `'use client'` component transitively imports this
// barrel.  Server-only exports live in `@/modules/sessions/server` — see
// `./server.ts`.

// ---- Result types (re-exported for convenience — type-only, zero runtime) ---
export type { CreateRecurringSessionResult } from './server/create-recurring-session';
export type { EditRecurringSessionResult } from './server/edit-recurring-session';
export type { CancelRecurringSessionResult } from './server/cancel-recurring-session';
export type { CreateCoupleSessionResult } from './server/create-couple-session';
export type { CreateLateRecordResult } from './server/create-late-record';

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

// ---- Components — couple session fields -------------------------------------
export {
  CoupleSessionFields,
  type CoupleSessionFieldsProps,
  type PatientOption,
} from './components/couple-session-fields';

// ---- Components — late record toggle ----------------------------------------
export { LateRecordToggle, type LateRecordToggleProps } from './components/late-record-toggle';

// ---- Components — recurrence form section -----------------------------------
export { RecurrenceFormSection } from './components/recurrence-form-section';
