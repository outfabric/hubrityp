/**
 * Inngest client for the medical-records module.
 *
 * Re-uses the same application-level Inngest client ID ('hubrityp') so that
 * all functions register under a single app in the Inngest dashboard. The
 * WhatsApp module uses the same pattern — a shared `id` with per-module
 * client files for organizational clarity.
 */

import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'hubrityp' });
