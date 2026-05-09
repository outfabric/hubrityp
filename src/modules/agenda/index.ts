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

// ---- Zod Schemas ------------------------------------------------------------
export { locationInputSchema, type LocationInput } from './lib/location-input-schema';
