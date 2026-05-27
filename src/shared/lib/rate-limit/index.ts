// Barrel for the rate-limiting module.
//
// Re-exports the in-memory limiter for backward compatibility with existing
// consumers (`api/video/log`, `api/video/join`).
//
// The Postgres-backed limiter (`./postgres.ts`) is NOT re-exported here to
// avoid pulling `server-only` + `@/shared/db/client` into contexts that only
// need the lightweight in-memory variant. Consumers that need it should
// import directly:
//   import { enforceRateLimit } from '@/shared/lib/rate-limit/postgres';
export { createRateLimiter, extractClientIp } from './in-memory';
