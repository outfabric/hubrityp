/**
 * Inngest serve handler — registers all WhatsApp Inngest functions so the
 * Inngest dev server / cloud can discover and invoke them via HTTP.
 *
 * Exports GET, POST, and PUT as required by the Inngest SDK for Next.js
 * App Router integration.
 */

import { serve } from 'inngest/next';

import { cancellationNoticeSender } from '@/modules/whatsapp/inngest/cancellation-notice-sender';
import { inngest } from '@/modules/whatsapp/inngest/client';
import { confirmationAckSender } from '@/modules/whatsapp/inngest/confirmation-ack-sender';
import { inboxMessageIngest } from '@/modules/whatsapp/inngest/inbox/inbox-message-ingest';
import { reconciliationPoller } from '@/modules/whatsapp/inngest/reconciliation-poller';
import { reminderSender } from '@/modules/whatsapp/inngest/reminder-sender';
import { remindersDispatcher } from '@/modules/whatsapp/inngest/reminders-dispatcher';
import { webhookCancellationHandler } from '@/modules/whatsapp/inngest/webhook-cancellation-handler';
import { webhookConfirmationHandler } from '@/modules/whatsapp/inngest/webhook-confirmation-handler';
import { webhookStatusHandler } from '@/modules/whatsapp/inngest/webhook-status-handler';
import { webhookStopHandler } from '@/modules/whatsapp/inngest/webhook-stop-handler';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    remindersDispatcher,
    reminderSender,
    confirmationAckSender,
    cancellationNoticeSender,
    reconciliationPoller,
    webhookStatusHandler,
    webhookConfirmationHandler,
    webhookCancellationHandler,
    webhookStopHandler,
    inboxMessageIngest,
  ],
});
