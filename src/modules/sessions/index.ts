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

// ---- Lib — session history schema + result types ---------------------------
export {
  sessionHistoryInputSchema,
  type SessionHistoryInput,
  PatientIdSchema,
  type PatientId,
  SESSION_HISTORY_STATUSES,
  type SessionHistoryStatus,
  type SessionModality,
  type SessionHistoryItem,
  type SessionHistorySummary,
  type SessionHistoryErrorCode,
  type SessionHistoryResult,
} from './lib/session-history-schema';

// ---- Lib — attendance rate (RN-13.03) ---------------------------------------
export { computeAttendanceRate, type AttendanceRateBuckets } from './lib/compute-attendance-rate';

// ---- Lib — session-history presentation helpers (RF-13.06, RN-13.05) --------
export {
  monthGroupKey,
  monthGroupLabel,
  formatFullDateWithWeekday,
  formatTime,
  formatTimeRange,
  STATUS_PRESENTATION,
  MODALITY_ICON,
  isFinalizedReadOnly,
  type SessionDisplayStatus,
  type StatusPresentation,
} from './lib/session-history-formatters';

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

// ---- Components — session history card (RF-13.05–13.08, RN-13.04–13.06) ------
export {
  SessionHistoryCard,
  type SessionHistoryCardProps,
} from './components/session-history-card';

// ---- Components — summary strip (RF-13.01, RN-13.03) -------------------------
export {
  SessionHistorySummaryStrip,
  type SessionHistorySummaryStripProps,
} from './components/session-history-summary-strip';

// ---- Components — filter chips (RF-13.10) ------------------------------------
export {
  SessionHistoryFilterChips,
  type SessionHistoryFilterChipsProps,
  type SessionHistoryFilterValue,
} from './components/session-history-filter-chips';

// ---- Components — history tab container (RF-13.04, RF-13.16–13.19) -----------
export {
  PatientSessionHistory,
  type PatientSessionHistoryProps,
} from './components/patient-session-history';

// ---- Hooks — hybrid (client ≤50 / server >50) status filter (D5) ------------
export {
  useSessionHistoryFilter,
  selectVisibleSessions,
  resolveServerStatus,
  shouldFilterServerSide,
  CLIENT_FILTER_THRESHOLD,
  SessionHistoryFetchError,
  type FetchSessionHistoryPage,
  type UseSessionHistoryFilterParams,
} from './hooks/use-session-history-filter';
