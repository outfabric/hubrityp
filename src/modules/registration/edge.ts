// Edge-runtime barrel for the `registration` module.
//
// Why a separate barrel from `index.ts`: the canonical barrel re-exports
// `getCurrentProfile` (Drizzle-backed) AND the Server Actions, both of
// which transitively pull `postgres-js` → `node:crypto`. Bundling those
// into the Next.js middleware (which runs on Edge) crashes with
// `Native module not found: node:crypto`. Tree-shaking can't help here
// because Drizzle's `db` client is created at module-top-level — the side
// effect prevents elimination.
//
// This barrel re-exports ONLY symbols that are safe to evaluate inside an
// Edge worker:
//   - `getCurrentProfileEdge` — uses Supabase REST, no Node-only deps.
//   - `Profile` (type-only) — Drizzle type, but TypeScript types are
//     erased at runtime, so this carries no Edge-incompatible code.
//   - `ProfileStatus` — pure value enum, no DB access.
//
// Consumers running on Edge (today: `src/middleware.ts`) MUST import from
// this entrypoint. Everything else continues to import from
// `@/modules/registration` and gets the full Drizzle-backed surface.
//
// Direct imports from `@/modules/registration/server/get-profile-edge` are
// intentionally NOT supported — keep the public surface centralized so a
// future refactor (e.g. caching, batching) only needs to touch this file.
export { getCurrentProfileEdge } from './server/get-profile-edge';
export { ProfileStatus } from './lib/profile-status';
export type { Profile } from './lib/profile';
