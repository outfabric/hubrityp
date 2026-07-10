import { type NextRequest } from 'next/server';

import { inngest, WHATSAPP_EVENTS } from '@/modules/whatsapp/inngest/client';
import { sendFreeText } from '@/modules/whatsapp/server/adapters/twilio-bsp';
import { validateTwilioSignature } from '@/modules/whatsapp/server/adapters/twilio-signature';
import { processInboundAutoReply } from '@/modules/whatsapp/server/auto-reply-inbound';
import { db } from '@/shared/db/client';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Button text values sent by Twilio Quick Reply buttons. */
const BUTTON_CONFIRM = 'Confirmar';
const BUTTON_CANCEL = 'Nao posso comparecer';

/** PARAR regex — exact match only (trimmed, case-insensitive). */
function isStopCommand(body: string): boolean {
  return body.trim().toUpperCase() === 'PARAR';
}

// ---------------------------------------------------------------------------
// Webhook payload classification
// ---------------------------------------------------------------------------

type WebhookType =
  | { type: 'status_update' }
  | { type: 'button_confirm' }
  | { type: 'button_cancel' }
  | { type: 'stop_command' }
  | { type: 'inbound_text' };

function classifyPayload(params: Record<string, string>): WebhookType {
  // Status callbacks include a MessageStatus field
  if (params.MessageStatus) {
    return { type: 'status_update' };
  }

  // Button replies: Twilio sends ButtonText for quick reply buttons
  const buttonText = params.ButtonText;
  if (buttonText === BUTTON_CONFIRM) {
    return { type: 'button_confirm' };
  }
  if (buttonText === BUTTON_CANCEL) {
    return { type: 'button_cancel' };
  }

  // Check for PARAR stop command in the Body field
  const body = params.Body ?? '';
  if (body.length > 0 && isStopCommand(body)) {
    return { type: 'stop_command' };
  }

  // Default: generic inbound text message
  return { type: 'inbound_text' };
}

// ---------------------------------------------------------------------------
// Inngest event emission helpers
// ---------------------------------------------------------------------------

async function emitStatusUpdated(params: Record<string, string>): Promise<void> {
  await inngest.send({
    name: WHATSAPP_EVENTS.STATUS_UPDATED,
    data: {
      bspMessageId: params.MessageSid ?? '',
      status: params.MessageStatus ?? '',
      errorCode: params.ErrorCode ? Number(params.ErrorCode) : undefined,
      errorMessage: params.ErrorMessage,
    },
  });
}

async function emitConfirmationReceived(params: Record<string, string>): Promise<void> {
  // The original outbound message SID is referenced by OriginalRepliedMessageSid
  // or we use the inbound MessageSid. The session/patient/user resolution
  // happens in the Inngest handler, not here.
  await inngest.send({
    name: WHATSAPP_EVENTS.CONFIRMATION_RECEIVED,
    data: {
      bspMessageId: params.MessageSid ?? '',
      sessionId: '', // Resolved by the Inngest handler from the original message
      patientId: '', // Resolved by the Inngest handler
      userId: '', // Resolved by the Inngest handler
      originalBspMessageId: params.OriginalRepliedMessageSid ?? '',
      fromPhone: params.From?.replace('whatsapp:', '') ?? '',
    },
  });
}

async function emitCancellationReceived(params: Record<string, string>): Promise<void> {
  await inngest.send({
    name: WHATSAPP_EVENTS.CANCELLATION_RECEIVED,
    data: {
      bspMessageId: params.MessageSid ?? '',
      sessionId: '', // Resolved by the Inngest handler
      patientId: '', // Resolved by the Inngest handler
      userId: '', // Resolved by the Inngest handler
      message: params.Body,
      originalBspMessageId: params.OriginalRepliedMessageSid ?? '',
      fromPhone: params.From?.replace('whatsapp:', '') ?? '',
    },
  });
}

async function emitStopReceived(params: Record<string, string>): Promise<void> {
  await inngest.send({
    name: WHATSAPP_EVENTS.STOP_RECEIVED,
    data: {
      fromPhone: params.From?.replace('whatsapp:', '') ?? '',
      patientId: '', // Resolved by the Inngest handler
      userId: '', // Resolved by the Inngest handler
    },
  });
}

/**
 * Handles an inbound free-text message: send a single throttled auto-reply
 * (fixed, non-clinical body) and persist the inbound for the LGPD audit
 * trail. This branch does NOT feed the inbox (`whatsapp/inbound.received`
 * is no longer emitted) and never touches `whatsapp_conversations`.
 *
 * Runs inline so the auto-reply goes out inside Meta's fresh 24h window; the
 * caller wraps it in try/catch so a failure still returns 200 to Twilio.
 */
async function triggerInboundAutoReply(params: Record<string, string>): Promise<void> {
  const platformPhone = serverEnv.TWILIO_WHATSAPP_FROM;

  if (!platformPhone) {
    logger.error(
      { event: 'twilio_webhook_auto_reply_no_platform_number' },
      'TWILIO_WHATSAPP_FROM not configured — skipping inbound auto-reply',
    );
    return;
  }

  await processInboundAutoReply(
    {
      fromPhone: params.From?.replace('whatsapp:', '') ?? '',
      bspMessageId: params.MessageSid ?? '',
      platformPhone: platformPhone.replace('whatsapp:', ''),
    },
    { db, sendFreeText },
  );
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/twilio/whatsapp
 *
 * Receives Twilio WhatsApp webhook callbacks (status updates, inbound
 * messages, button replies). The handler performs minimal synchronous work:
 *
 *   1. Read raw body for HMAC validation
 *   2. Validate X-Twilio-Signature
 *   3. Parse URL-encoded body into key-value params
 *   4. Classify event type (status / confirm / cancel / stop / inbound)
 *   5. Emit the corresponding Inngest event
 *   6. Return 200
 *
 * No business logic runs synchronously — all processing is deferred to
 * Inngest functions.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Step 1: Read raw body for HMAC validation
  const rawBody = await request.text();

  // Step 2: Validate X-Twilio-Signature
  const signature = request.headers.get('X-Twilio-Signature') ?? '';
  const twilioAuthToken = serverEnv.TWILIO_AUTH_TOKEN;
  const twilioWebhookUrl = serverEnv.TWILIO_WEBHOOK_URL;

  if (!twilioAuthToken || !twilioWebhookUrl) {
    logger.error(
      { event: 'twilio_webhook_config_missing' },
      'TWILIO_AUTH_TOKEN or TWILIO_WEBHOOK_URL not configured',
    );
    return new Response('Server configuration error', { status: 500 });
  }

  // Step 3: Parse URL-encoded body
  const urlParams = new URLSearchParams(rawBody);
  const params: Record<string, string> = {};
  for (const [key, value] of urlParams.entries()) {
    params[key] = value;
  }

  const isValid = validateTwilioSignature(twilioAuthToken, signature, twilioWebhookUrl, params);

  if (!isValid) {
    logger.warn(
      { event: 'twilio_webhook_invalid_signature' },
      'Invalid Twilio webhook signature — rejecting request',
    );
    return new Response('Forbidden', { status: 403 });
  }

  // Step 4: Classify the incoming payload
  const classification = classifyPayload(params);

  // Step 5: Emit the corresponding Inngest event
  try {
    switch (classification.type) {
      case 'status_update':
        await emitStatusUpdated(params);
        break;
      case 'button_confirm':
        await emitConfirmationReceived(params);
        break;
      case 'button_cancel':
        await emitCancellationReceived(params);
        break;
      case 'stop_command':
        await emitStopReceived(params);
        break;
      case 'inbound_text':
        await triggerInboundAutoReply(params);
        break;
    }

    logger.info(
      {
        event: 'twilio_webhook_processed',
        type: classification.type,
        messageSid: params.MessageSid,
      },
      `Twilio webhook processed: ${classification.type}`,
    );
  } catch (err: unknown) {
    // Log but still return 200 to prevent Twilio from retrying.
    // The event will be retried via dead letter / manual requeue.
    logger.error(
      {
        event: 'twilio_webhook_inngest_emit_failed',
        type: classification.type,
        errorName: err instanceof Error ? err.name : 'UnknownError',
      },
      'Failed to emit Inngest event for Twilio webhook',
    );
  }

  // Step 6: Return 200 (Twilio expects 200 to acknowledge receipt)
  return new Response('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
