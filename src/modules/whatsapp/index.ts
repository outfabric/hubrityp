// Public API of the `whatsapp` module.
//
// Per project conventions, every module exposes its surface through a single
// `index.ts` barrel — consumers MUST import from `@/modules/whatsapp`, never
// from internal paths like `@/modules/whatsapp/server/...`.
//
// This file is intentionally NEUTRAL — no `'use server'` directive at the top
// level. The barrel re-exports Server Action implementations, pure helpers,
// and types. The `'use server'` directives live on the route shells under
// `src/app/`.

// ---- Server Actions (delegated to by the route shells) -----------------------
export {
  startTwilioConnectionImpl,
  type StartTwilioConnectionResult,
  type StartConnectionInput,
  startConnectionInputSchema,
} from './server/start-twilio-connection';
export {
  completeTwilioConnectionImpl,
  type CompleteTwilioConnectionResult,
  type CompleteConnectionInput,
  completeConnectionInputSchema,
} from './server/complete-twilio-connection';
export {
  getWhatsappAccountImpl,
  type GetWhatsappAccountResult,
} from './server/get-whatsapp-account';
export {
  disconnectWhatsappImpl,
  type DisconnectWhatsappResult,
} from './server/disconnect-whatsapp';
export {
  healthCheckWhatsappImpl,
  type HealthCheckWhatsappResult,
} from './server/health-check-whatsapp';

// ---- Internal helpers (not Server Actions) -----------------------------------
export { seedDefaultTemplates } from './server/seed-default-templates';

// ---- Zod Schemas -------------------------------------------------------------
export { phoneNumberSchema, type PhoneNumber } from './lib/phone-number-schema';
export { templateKeySchema, type TemplateKey } from './lib/template-key-schema';
export { templateInputSchema, type TemplateInput } from './lib/template-input-schema';

// ---- Template helpers --------------------------------------------------------
export {
  renderTemplate,
  MissingTemplateVariableError,
} from './lib/render-template';
export {
  TEMPLATE_VARIABLES,
  VALID_VARIABLE_KEYS,
  getVariableByKey,
  type TemplateVariable,
} from './lib/template-variables';
