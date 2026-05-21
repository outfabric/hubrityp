// Public API of the `telepsicologia` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/telepsicologia`,
// never from internal paths like `@/modules/telepsicologia/server/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports Server Action implementations, pure helpers,
// and types. If it carried `'use server'`, every export would be transformed
// into an RPC stub by the Next.js compiler and the schema/type re-exports
// would break.
//
// The `'use server'` directives live on the route shells under `src/app/`
// which import the implementations from this barrel and re-export them as
// bona fide Server Actions for the Next.js compiler.
//
// `getCurrentProfileEdge`-style note: the Edge-safe surface for future
// middleware consumption lives in `@/modules/telepsicologia/edge`. Bundling
// Drizzle + Stream SDK into an Edge worker crashes with
// `Native module not found: node:crypto`, so the Edge-safe subset is
// published through a dedicated entrypoint (`edge.ts`).

// ---- Server Actions (delegated to by the route shells) -----------------------
export { createVideoRoomImpl, type CreateVideoRoomResult } from './server/create-video-room';
export { getVideoTokenImpl, type GetVideoTokenResult } from './server/get-video-token';

// ---- Zod Schemas -------------------------------------------------------------
export {
  videoRoomInputSchema,
  type VideoRoomInput,
  videoTokenInputSchema,
  type VideoTokenInput,
  VIDEO_ROOM_STATUSES,
  type VideoRoomStatus,
} from './lib/schemas';

// ---- Types (Drizzle-inferred — canonical row shape) -------------------------
export type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';

// ---- Pure helpers ------------------------------------------------------------
export { generatePatientVideoUrl } from './lib/video-url';
