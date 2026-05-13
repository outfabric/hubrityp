import 'server-only';

import twilio from 'twilio';
import type RestException from 'twilio/lib/base/RestException';

import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Typed error codes returned when the Twilio Messages API rejects a send.
 * Each variant maps to a specific Twilio error code — see Decision 2 in
 * the design doc.
 */
export type TwilioSendErrorCode =
  | 'INVALID_PHONE'
  | 'BLOCKED_BY_USER'
  | 'OPT_OUT'
  | 'RATE_LIMIT'
  | 'UNKNOWN';

export interface TwilioSendError {
  code: TwilioSendErrorCode;
  twilioCode: number | undefined;
  message: string;
}

const TWILIO_ERROR_MAP: Record<number, TwilioSendErrorCode> = {
  21211: 'INVALID_PHONE',
  21610: 'BLOCKED_BY_USER',
  21614: 'OPT_OUT',
  20429: 'RATE_LIMIT',
};

function mapTwilioError(err: unknown): TwilioSendError {
  // Twilio SDK throws RestException with `code` and `status` fields.
  const twilioCode = isTwilioRestException(err) ? err.code : undefined;
  const mapped = twilioCode !== undefined ? TWILIO_ERROR_MAP[twilioCode] : undefined;

  return {
    code: mapped ?? 'UNKNOWN',
    twilioCode,
    message: err instanceof Error ? err.message : 'Unknown Twilio error',
  };
}

/**
 * Type guard for Twilio RestException. We check for the `code` and `status`
 * properties that distinguish it from a generic Error.
 */
function isTwilioRestException(err: unknown): err is RestException {
  return (
    err instanceof Error &&
    typeof (err as RestException).status === 'number' &&
    typeof (err as RestException).code === 'number'
  );
}

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface SendTemplateInput {
  /** Recipient phone in E.164 format (e.g., "+5511999998888"). */
  to: string;
  /** Psychologist's whatsapp_account.id — used only for logging/tracing. */
  fromAccountId: string;
  /** Template key (e.g., "lembrete_24h") — used for logging/tracing. */
  templateKey: string;
  /** Twilio Content SID (the `metaTemplateId` from message_templates). */
  contentSid: string;
  /** Key-value pairs injected into the template placeholders. */
  variables: Record<string, string>;
  /** Pre-rendered body text — used as fallback `body` for non-template sends. */
  bodyRendered: string;
  /** Optional LGPD consent footer appended to the body. */
  consentFooter?: string;
}

export interface SendTemplateSuccess {
  bspMessageId: string;
  status: string;
}

export type SendTemplateResult =
  | { ok: true; data: SendTemplateSuccess }
  | { ok: false; error: TwilioSendError };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Sends a WhatsApp template message through Twilio's Messages API.
 *
 * When a `contentSid` is provided, the message is sent as a template message
 * using `contentSid` + `contentVariables`. The `bodyRendered` (with optional
 * `consentFooter`) is passed as the `body` parameter — Twilio uses it as
 * fallback text for non-WhatsApp channels.
 *
 * Error codes from Twilio are mapped to typed `TwilioSendError` variants
 * (see `TWILIO_ERROR_MAP`).
 */
// ---------------------------------------------------------------------------
// Free-text messaging (within 24h session window)
// ---------------------------------------------------------------------------

export interface SendFreeTextInput {
  /** Recipient phone in E.164 format (e.g., "+5511999998888"). */
  to: string;
  /** The free-text message body. */
  body: string;
}

export interface SendFreeTextSuccess {
  bspMessageId: string;
  status: string;
}

export type SendFreeTextResult =
  | { ok: true; data: SendFreeTextSuccess }
  | { ok: false; error: TwilioSendError };

/**
 * Sends a free-text WhatsApp message through Twilio's Messages API.
 *
 * Free-text messages can only be sent within Meta's 24-hour session window
 * (i.e., the patient must have sent an inbound message in the last 24 hours).
 * Window enforcement is handled by the caller — this function only handles
 * the BSP send.
 */
export async function sendFreeText(input: SendFreeTextInput): Promise<SendFreeTextResult> {
  const { to, body } = input;

  const accountSid = serverEnv.TWILIO_ACCOUNT_SID;
  const authToken = serverEnv.TWILIO_AUTH_TOKEN;
  const fromNumber = serverEnv.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !fromNumber) {
    logger.error(
      { event: 'twilio_credentials_missing_free_text' },
      'Twilio credentials not configured — cannot send free-text message',
    );
    return {
      ok: false,
      error: {
        code: 'UNKNOWN',
        twilioCode: undefined,
        message: 'Twilio credentials not configured',
      },
    };
  }

  const client = twilio(accountSid, authToken);

  try {
    const message = await client.messages.create({
      to: `whatsapp:${to}`,
      from: `whatsapp:${fromNumber}`,
      body,
    });

    logger.info(
      {
        event: 'whatsapp_free_text_sent',
        bspMessageId: message.sid,
        status: message.status,
      },
      'WhatsApp free-text message sent successfully',
    );

    return {
      ok: true,
      data: {
        bspMessageId: message.sid,
        status: message.status,
      },
    };
  } catch (err: unknown) {
    const sendError = mapTwilioError(err);

    logger.error(
      {
        event: 'whatsapp_free_text_send_failed',
        errorCode: sendError.code,
        twilioCode: sendError.twilioCode,
      },
      'Failed to send WhatsApp free-text message',
    );

    return { ok: false, error: sendError };
  }
}

// ---------------------------------------------------------------------------
// Template messaging
// ---------------------------------------------------------------------------

export async function sendTemplate(input: SendTemplateInput): Promise<SendTemplateResult> {
  const { to, fromAccountId, templateKey, contentSid, variables, bodyRendered, consentFooter } =
    input;

  const accountSid = serverEnv.TWILIO_ACCOUNT_SID;
  const authToken = serverEnv.TWILIO_AUTH_TOKEN;
  const fromNumber = serverEnv.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !fromNumber) {
    logger.error(
      { event: 'twilio_credentials_missing', templateKey },
      'Twilio credentials not configured — cannot send template message',
    );
    return {
      ok: false,
      error: {
        code: 'UNKNOWN',
        twilioCode: undefined,
        message: 'Twilio credentials not configured',
      },
    };
  }

  const client = twilio(accountSid, authToken);

  // Build body: rendered text + optional LGPD consent footer
  const body = consentFooter ? `${bodyRendered}\n\n${consentFooter}` : bodyRendered;

  try {
    const message = await client.messages.create({
      to: `whatsapp:${to}`,
      from: `whatsapp:${fromNumber}`,
      contentSid,
      contentVariables: JSON.stringify(variables),
      body,
    });

    logger.info(
      {
        event: 'whatsapp_template_sent',
        templateKey,
        bspMessageId: message.sid,
        status: message.status,
      },
      'WhatsApp template message sent successfully',
    );

    return {
      ok: true,
      data: {
        bspMessageId: message.sid,
        status: message.status,
      },
    };
  } catch (err: unknown) {
    const sendError = mapTwilioError(err);

    logger.error(
      {
        event: 'whatsapp_template_send_failed',
        templateKey,
        fromAccountId,
        errorCode: sendError.code,
        twilioCode: sendError.twilioCode,
      },
      'Failed to send WhatsApp template message',
    );

    return { ok: false, error: sendError };
  }
}
