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

export {
  listTemplatesImpl,
  type ListTemplatesResult,
  type TemplatePreview,
} from './server/list-templates';
export { getTemplateImpl, type GetTemplateResult } from './server/get-template';
export { updateTemplateImpl, type UpdateTemplateResult } from './server/update-template';
export {
  getTemplateMetaStatusImpl,
  type GetTemplateMetaStatusResult,
} from './server/get-template-meta-status';

export {
  updatePatientWhatsappOptOutImpl,
  updatePatientOptOutInputSchema,
  type UpdatePatientOptOutResult,
  type UpdatePatientOptOutInput,
} from './server/update-patient-whatsapp-opt-out';

// ---- Zod Schemas -------------------------------------------------------------
export { phoneNumberSchema, type PhoneNumber } from './lib/phone-number-schema';
export { templateKeySchema, type TemplateKey } from './lib/template-key-schema';
export { templateInputSchema, type TemplateInput } from './lib/template-input-schema';

// ---- Template helpers --------------------------------------------------------
export { renderTemplate, MissingTemplateVariableError } from './lib/render-template';
export {
  TEMPLATE_VARIABLES,
  VALID_VARIABLE_KEYS,
  getVariableByKey,
  type TemplateVariable,
} from './lib/template-variables';

// ---- BSP adapter (Twilio) ---------------------------------------------------
export {
  sendTemplate,
  type SendTemplateInput,
  type SendTemplateResult,
  type SendTemplateSuccess,
  type TwilioSendError,
  type TwilioSendErrorCode,
} from './server/adapters/twilio-bsp';

// ---- Twilio webhook signature validation ------------------------------------
export { validateTwilioSignature } from './server/adapters/twilio-signature';

// ---- Inngest client + event types -------------------------------------------
export {
  inngest,
  WHATSAPP_EVENTS,
  type ReminderSendEventData,
  type StatusUpdatedEventData,
  type ConfirmationReceivedEventData,
  type CancellationReceivedEventData,
  type StopReceivedEventData,
  type InboundReceivedEventData,
  type ConfirmationAckEventData,
} from './inngest/client';

// ---- Inngest functions (registered in the API route) ------------------------
export { remindersDispatcher } from './inngest/reminders-dispatcher';
export { reminderSender } from './inngest/reminder-sender';
export { confirmationAckSender } from './inngest/confirmation-ack-sender';
export { cancellationNoticeSender } from './inngest/cancellation-notice-sender';
export { reconciliationPoller } from './inngest/reconciliation-poller';
export { webhookStatusHandler } from './inngest/webhook-status-handler';
export { webhookConfirmationHandler } from './inngest/webhook-confirmation-handler';
export { webhookCancellationHandler } from './inngest/webhook-cancellation-handler';
export { webhookStopHandler } from './inngest/webhook-stop-handler';

// ---- Reminder helpers -------------------------------------------------------
export { computeReminderWindow } from './lib/reminders/compute-reminder-window';
export { generateIdempotencyKey } from './lib/reminders/idempotency-key';
export { selectTemplateVariables } from './lib/reminders/select-template-variables';
export { reminderSettingsSchema } from './lib/reminders/reminder-settings-schema';

// ---- Reminder Server Actions ------------------------------------------------
export {
  getReminderSettingsImpl,
  type GetReminderSettingsResult,
  type ReminderSettingsData,
} from './server/reminders/get-reminder-settings';
export {
  saveReminderSettingsImpl,
  type SaveReminderSettingsResult,
} from './server/reminders/save-reminder-settings';
export {
  toggleSessionRemindersImpl,
  type ToggleSessionRemindersResult,
} from './server/reminders/toggle-session-reminders';
