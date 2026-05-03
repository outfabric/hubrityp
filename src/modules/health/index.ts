// Health module public API.
//
// At present the health capability has no module-internal helpers: its surface
// is exposed via the Drizzle schema at `@/shared/db/schema/health` and the
// `/api/health` route handler under `src/app/api/health/`. This barrel exists
// so future health-specific helpers can be re-exported here without consumers
// reaching into module internals.
export {};
