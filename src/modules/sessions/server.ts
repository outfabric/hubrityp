// Server-only barrel for the `sessions` module.
//
// This file re-exports Server Action implementations that use `import 'server-only'`.
// It MUST NOT be imported from any `'use client'` component or from the main
// `sessions/index.ts` barrel — doing so would cause a build error because the
// browser bundler cannot process the `server-only` guard.
//
// Consumers that need these implementations (e.g. `src/app/(app)/agenda/actions.ts`)
// should import from `@/modules/sessions/server`.

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

// ---- Read queries (patient session-history summary) -------------------------
export {
  getPatientSessionSummary,
  type PatientSessionSummaryResult,
} from './server/get-patient-session-summary';

// ---- Read queries (patient session-history list + future session) -----------
export {
  getNearestFutureSession,
  type NearestFutureSessionResult,
} from './server/get-nearest-future-session';
export {
  getPatientSessionHistoryList,
  type SessionHistoryListResult,
} from './server/get-patient-session-history-list';
