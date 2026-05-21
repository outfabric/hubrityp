// Edge-runtime barrel for the `telepsicologia` module.
//
// Why a separate barrel from `index.ts`: the canonical barrel re-exports
// `createVideoRoomImpl` and `getVideoTokenImpl`, both of which transitively
// pull `@stream-io/node-sdk`, `postgres-js` → `node:crypto`, and
// `server-only`. Bundling those into the Next.js middleware (which runs on
// Edge) crashes with `Native module not found: node:crypto`. Tree-shaking
// can't help because Drizzle's `db` client and the Stream SDK singleton are
// created at module-top-level — the side effects prevent elimination.
//
// This barrel re-exports ONLY symbols that are safe to evaluate inside an
// Edge worker:
//   - `generatePatientVideoUrl` — pure function, zero imports.
//   - Zod input schemas (`videoRoomInputSchema`, `videoTokenInputSchema`) —
//     only import from `zod`, which is edge-safe.
//   - Types (`VideoRoomInput`, `VideoTokenInput`, `VideoRoomStatus`,
//     `VideoRoom`) — erased at runtime, carry no Edge-incompatible code.
//   - `VIDEO_ROOM_STATUSES` — pure `as const` array, no deps.
//
// MUST NOT export: `createVideoRoomImpl`, `getVideoTokenImpl`,
// `getStreamClient`, or anything under `./server/` — all pull Node-only deps.
//
// Imports go directly to `./lib/` source files (NOT via `./index`) to avoid
// transitively dragging in `./server/` modules.
//
// Consumers running on Edge (future: `src/middleware.ts` when video routes
// are classified) MUST import from this entrypoint. Everything else continues
// to import from `@/modules/telepsicologia` and gets the full surface.

// ---- Pure helpers ------------------------------------------------------------
export { generatePatientVideoUrl } from './lib/video-url';

// ---- Zod Schemas (edge-safe — only imports `zod`) ----------------------------
export {
  videoRoomInputSchema,
  type VideoRoomInput,
  videoTokenInputSchema,
  type VideoTokenInput,
  VIDEO_ROOM_STATUSES,
  type VideoRoomStatus,
} from './lib/schemas';

// ---- Types (erased at runtime — safe for Edge) -------------------------------
export type { VideoRoom } from './lib/schemas';
