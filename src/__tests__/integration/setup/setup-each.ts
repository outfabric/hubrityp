// Per-test-file setup for the integration suite.
//
// `globalSetup` runs once in a separate process and exports env vars; this
// file runs in EACH worker, so anything that needs to live on the worker's
// `globalThis` (e.g. test-only feature flags) belongs here.
//
// The Edge-safe logger used by `src/middleware.ts` honours
// `globalThis.__EDGE_LOGGER_SILENT` to suppress its `console.<level>`
// emissions during tests. We flip it on here so middleware tests don't
// pollute Vitest's stdout with one log line per assertion.
globalThis.__EDGE_LOGGER_SILENT = true;
