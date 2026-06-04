/**
 * Inngest serve handler — registers all Inngest functions so the
 * Inngest dev server / cloud can discover and invoke them via HTTP.
 *
 * Exports GET, POST, and PUT as required by the Inngest SDK for Next.js
 * App Router integration.
 */

import { serve } from 'inngest/next';

import { discardOldAudios } from '@/modules/ai-transcription/inngest/discard-old-audios';
import { ingestStreamRecording } from '@/modules/ai-transcription/inngest/ingest-stream-recording';
import { onConsentRevoked } from '@/modules/ai-transcription/inngest/on-consent-revoked';
import { processAudioTranscription } from '@/modules/ai-transcription/inngest/process-audio-transcription';
import { purgeFailedAudios } from '@/modules/ai-transcription/inngest/purge-failed-audios';
import { expireProntuarioExportsCron } from '@/modules/medical-records/inngest/expire-exports';
import { expireRemoteTokens } from '@/modules/medical-records/inngest/expire-remote-tokens';
import { prontuarioExportPdfFunction } from '@/modules/medical-records/inngest/export-pdf';
import { generateDocumentPdf } from '@/modules/medical-records/inngest/generate-document-pdf';
import { remindMissingEvolution } from '@/modules/medical-records/inngest/remind-missing-evolution';
import { autoReadOldNotifications } from '@/modules/notifications/inngest/auto-read-old';
import { autoCreateVideoRoom } from '@/modules/telepsicologia/inngest/auto-create-room';
import { cancelRoomOnSessionCancel } from '@/modules/telepsicologia/inngest/cancel-room-on-session-cancel';
import { recordingCleanupCron } from '@/modules/telepsicologia/inngest/recording-cleanup';
import { roomExpiryCron } from '@/modules/telepsicologia/inngest/room-expiry';
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
    discardOldAudios,
    purgeFailedAudios,
    ingestStreamRecording,
    processAudioTranscription,
    onConsentRevoked,
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
    remindMissingEvolution,
    autoReadOldNotifications,
    expireRemoteTokens,
    generateDocumentPdf,
    prontuarioExportPdfFunction,
    expireProntuarioExportsCron,
    autoCreateVideoRoom,
    cancelRoomOnSessionCancel,
    recordingCleanupCron,
    roomExpiryCron,
  ],
});
