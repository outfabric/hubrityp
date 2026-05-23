// Client-safe entrypoint for the `medical-records` module.
//
// Analogous to `registration/edge.ts`: external client components that need
// types, Zod schemas, and UI components from this module import from
// `@/modules/medical-records/client` instead of the main barrel, which
// re-exports server-only code (Drizzle queries, `import 'server-only'` files)
// and would crash the client bundler.
//
// Rule: NOTHING exported here may transitively import `server-only`, `postgres`,
// `@/shared/db/client`, or any other Node-only module.

// ---- Types (serializable, no runtime deps) ----------------------------------
export type { EvolutionSummary } from './lib/evolution-types';

// ---- Zod Schemas (pure Zod — client-safe) -----------------------------------
export {
  createEvolutionInputSchema,
  updateEvolutionInputSchema,
  type CreateEvolutionInput,
  type UpdateEvolutionInput,
} from './lib/evolution-schemas';

// ---- Template Types ---------------------------------------------------------
export { TEMPLATE_TYPES, TEMPLATE_OPTIONS, type TemplateType } from './lib/template-types';

// ---- Client Components ------------------------------------------------------
export { EvolutionEditor } from './components/evolution-editor';
export { TemplateSelector } from './components/template-selector';
