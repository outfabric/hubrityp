// Public API of the `crp-validation` module.
//
// Per the `reorganize-folder-structure` design decision, every module exposes
// its surface through a single `index.ts` barrel — consumers MUST import from
// `@/modules/crp-validation`, never from internal paths like
// `@/modules/crp-validation/lib/...`.
//
// `approveCrpValidation` and `rejectCrpValidation` are server-only
// implementations re-exported here for **server-side consumers** (admin
// route shells, integration tests). The future admin UI Client Components
// MUST consume these actions through their route shells under
// `src/app/(admin)/...` — importing from this barrel into a Client
// Component would drag the `'server-only'` chain (Drizzle client, logger,
// Supabase server client, account-lifecycle helpers) into the browser
// bundle and the RSC boundary checker would reject the build.
//
// The pure helpers (`crpNumberSchema`, `crpUfSchema`, `regionalCodeToUf`,
// `regionalCodes`) are safe to import from anywhere — server, client, or
// test — because they have no `'server-only'` dependency. The signup form
// Client Component imports `crpNumberSchema` and `crpUfSchema` from this
// barrel for inline validation, which works precisely because no `'use
// server'` directive lives at the top of this file. Marking the module as
// `'use server'` would force every named export to be RPC-able and would
// couple even the validators to the Server Action runtime, defeating the
// shell ↔ module split.
//
// This `index.ts` MUST NOT carry a top-level `'use server'` directive.

export { type CrpNumber, type CrpUf, crpNumberSchema, crpUfSchema } from './lib/crp-format';

export {
  type RegionalCode,
  type Uf,
  BRAZILIAN_UFS,
  regionalCodes,
  regionalCodeToUf,
} from './lib/regional-codes';

export {
  type ApproveCrpValidationArgs,
  type ApproveResult,
  approveCrpValidationImpl as approveCrpValidation,
} from './server/approve';

export {
  type RejectCrpValidationArgs,
  type RejectResult,
  rejectCrpValidationImpl as rejectCrpValidation,
} from './server/reject';
