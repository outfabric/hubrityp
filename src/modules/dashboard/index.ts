// Public API of the `dashboard` module.
//
// External consumers (the `/dashboard` page and its section components) import
// the four aggregate read helpers and their result types ONLY from here, never
// from internal `server/` or `lib/` paths.
//
// Each helper takes the RLS-scoped Supabase client, authenticates via
// `getUser()`, and scopes every query to `auth.uid()` — no caller-supplied id
// is ever accepted. Results carry counts, the day's session display fields, and
// server-computed deep-link targets only — never clinical content.

export { getTodaySessions } from './server/get-today-sessions';
export { getPendencias } from './server/get-pendencias';
export { getWeeklySummary } from './server/get-weekly-summary';
export { hasAnyData, type HasAnyDataResult } from './server/has-any-data';
export { stampFirstAccess, type StampFirstAccessResult } from './server/stamp-first-access';

export type {
  SessionModality,
  SessionStatus,
  TodaySessionView,
  TodaySessionsResult,
  PendenciasResult,
  WeeklySummaryResult,
  UnauthorizedResult,
} from './lib/types';
