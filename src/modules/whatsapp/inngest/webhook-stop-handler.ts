/**
 * Webhook PARAR handler — Inngest function that processes a patient's
 * opt-out command ("PARAR") received via WhatsApp.
 *
 * Triggered by `whatsapp/stop.received` events emitted by the Twilio
 * webhook Route Handler.
 *
 * Steps:
 *   1. Resolve the patient by phone number
 *   2. Set patient.whatsapp_opt_out=true, whatsapp_opt_out_at=NOW()
 *   3. (Future) Send confirmation message "Nao enviaremos mais lembretes..."
 *   4. (Future) Notify psychologist in-app
 *
 * PARAR matching rules (enforced by the Route Handler, NOT here):
 *   - Exact match only (trimmed, case-insensitive)
 *   - "quero parar de ir na quarta" is NOT treated as opt-out
 */

import { and, eq, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { patients } from '@/shared/db/schema/patients/tables';

import { inngest, WHATSAPP_EVENTS, type StopReceivedEventData } from './client';

// ---------------------------------------------------------------------------
// Extended event data
// ---------------------------------------------------------------------------

export interface WebhookStopEventData extends StopReceivedEventData {
  /** Phone number might be enriched by webhook handler. */
  fromPhone: string;
}

// ---------------------------------------------------------------------------
// Types for dependency injection (testability)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = PostgresJsDatabase<any>;

export interface StopHandlerDeps {
  db: DrizzleDb;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface StopHandlerResult {
  status: 'opted_out' | 'already_opted_out' | 'not_found';
  patientId?: string;
}

// ---------------------------------------------------------------------------
// Core logic (extracted for testing)
// ---------------------------------------------------------------------------

/**
 * Processes a PARAR opt-out command from a patient.
 *
 * Resolves the patient by phone number (matching either `phone` or
 * `reminder_phone`), then sets whatsapp_opt_out=true.
 */
export async function processStopCommand(
  eventData: WebhookStopEventData,
  deps: StopHandlerDeps,
): Promise<StopHandlerResult> {
  const { db } = deps;
  const { fromPhone } = eventData;

  if (!fromPhone) {
    return { status: 'not_found' };
  }

  // Resolve patient by phone number (match phone or reminder_phone)
  const matchingPatients = await db
    .select({
      id: patients.id,
      userId: patients.userId,
      whatsappOptOut: patients.whatsappOptOut,
    })
    .from(patients)
    .where(or(eq(patients.phone, fromPhone), eq(patients.reminderPhone, fromPhone)));

  if (matchingPatients.length === 0) {
    return { status: 'not_found' };
  }

  // Process opt-out for all matching patients (a phone number could be
  // shared across psychologists — each psychologist's patient record
  // needs to be updated independently).
  let anyUpdated = false;

  for (const patient of matchingPatients) {
    if (patient.whatsappOptOut) {
      continue; // Already opted out
    }

    await db
      .update(patients)
      .set({
        whatsappOptOut: true,
        whatsappOptOutAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(patients.id, patient.id), eq(patients.whatsappOptOut, false)));

    anyUpdated = true;
  }

  if (!anyUpdated) {
    return {
      status: 'already_opted_out',
      patientId: matchingPatients[0]!.id,
    };
  }

  return {
    status: 'opted_out',
    patientId: matchingPatients[0]!.id,
  };
}

// ---------------------------------------------------------------------------
// Inngest function
// ---------------------------------------------------------------------------

export const webhookStopHandler = inngest.createFunction(
  {
    id: 'whatsapp-webhook-stop-handler',
    triggers: [{ event: WHATSAPP_EVENTS.STOP_RECEIVED }],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    const { db } = await import('@/shared/db/client');
    const data = event.data as WebhookStopEventData;

    const result = await step.run('process-stop-command', async () => {
      return processStopCommand(data, { db });
    });

    logger.info(
      {
        event: 'webhook_stop_processed',
        result: result.status,
        patientId: result.patientId,
      },
      `PARAR command processed: ${result.status}`,
    );

    return result;
  },
);
