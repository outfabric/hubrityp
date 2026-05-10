// Public API of the `agenda` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/agenda`, never
// from internal paths like `@/modules/agenda/lib/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports Server Action implementations, pure helpers,
// and types; if it carried `'use server'`, every export would be transformed
// into an RPC stub by the Next.js compiler and the schema/type re-exports
// would break.

// ---- Server Actions (locations) ---------------------------------------------
export { listLocationsImpl, type ListLocationsResult } from './server/list-locations';
export { createLocationImpl, type CreateLocationResult } from './server/create-location';
export { updateLocationImpl, type UpdateLocationResult } from './server/update-location';
export { deleteLocationImpl, type DeleteLocationResult } from './server/delete-location';
export {
  setLocationDefaultImpl,
  type SetLocationDefaultResult,
} from './server/set-location-default';

// ---- Server Actions (agenda settings) ----------------------------------------
export { getAgendaSettingsImpl, type GetAgendaSettingsResult } from './server/get-agenda-settings';
export {
  saveAgendaSettingsImpl,
  type SaveAgendaSettingsResult,
} from './server/save-agenda-settings';

// ---- Server Actions (sessions) -----------------------------------------------
export {
  listSessionsImpl,
  type ListSessionsResult,
  type SessionWithDetails,
} from './server/list-sessions';
export { createSessionImpl, type CreateSessionResult } from './server/create-session';
export { updateSessionImpl, type UpdateSessionResult } from './server/update-session';
export { deleteSessionImpl, type DeleteSessionResult } from './server/delete-session';
export { markSessionDoneImpl, type MarkSessionDoneResult } from './server/mark-session-done';
export { getSessionHistoryImpl, type GetSessionHistoryResult } from './server/get-session-history';

// ---- Zod Schemas ------------------------------------------------------------
export { locationInputSchema, type LocationInput } from './lib/location-input-schema';
export {
  agendaSettingsInputSchema,
  type AgendaSettingsInput,
} from './lib/agenda-settings-input-schema';
export { sessionInputSchema, type SessionInput } from './lib/session-input-schema';

// ---- Lib — conflict detection -----------------------------------------------
export {
  detectConflicts,
  type CandidateInterval,
  type ExistingSession,
  type ConflictResult,
} from './lib/detect-conflicts';

// ---- Lib — date/timezone helpers --------------------------------------------
export {
  toSaoPauloTime,
  formatSessionTime,
  formatSessionDate,
  formatSessionDateFull,
  calculateEndTime,
  isInPast,
} from './lib/date-helpers';

// ---- Lib — session status state machine -------------------------------------
export {
  SESSION_STATUSES,
  type SessionStatus,
  VALID_TRANSITIONS,
  isValidTransition,
  type Action,
  getAvailableActions,
} from './lib/session-status';

// ---- Lib — session edit lock (RN-03.04) -------------------------------------
export { isSessionLocked } from './lib/session-lock';
