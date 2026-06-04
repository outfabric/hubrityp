import { z } from 'zod';

// ---------------------------------------------------------------------------
// Notification-preferences input schema (Zod is the single source of truth)
// ---------------------------------------------------------------------------

/**
 * Validates the payload accepted by `updateNotificationPreferencesImpl`.
 *
 * Only the three USER-EDITABLE toggles are part of the contract. `email_critical`
 * is intentionally OMITTED: it is a non-disableable, server-enforced flag (the
 * server always persists TRUE), so accepting it from the client would be
 * misleading and create a false impression that it can be turned off. An object
 * with an extra `emailCritical` key still parses — Zod strips unknown keys by
 * default — but the value is never read, so a client cannot influence it.
 */
export const updateNotificationPreferencesInputSchema = z.object({
  emailDaily: z.boolean(),
  emailWeekly: z.boolean(),
  inAppSound: z.boolean(),
});

export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesInputSchema
>;
