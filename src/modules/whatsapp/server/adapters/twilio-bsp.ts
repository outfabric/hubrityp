import 'server-only';

import twilio from 'twilio';
import type RestException from 'twilio/lib/base/RestException';

import { toE164 } from '@/modules/whatsapp/lib/phone-number-e164';
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
  /** Recipient phone — E.164 or masked BR format. Normalized to E.164 internally. */
  to: string;
  /** Template key (e.g., "lembrete_24h") — used for logging/tracing only. */
  templateKey: string;
  /** Platform Twilio Content SID resolved from `serverEnv`. */
  contentSid: string;
  /**
   * Named `contentVariables` for the Content template — the exact keys declared
   * in Twilio's Content Template Builder (e.g. `first_name`, `date`). Serialized
   * to JSON and sent as `contentVariables`.
   */
  variables: Record<string, string>;
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

// ---------------------------------------------------------------------------
// Free-text messaging (within 24h session window)
// ---------------------------------------------------------------------------

export interface SendFreeTextInput {
  /** Recipient phone — E.164 or masked BR format. Normalized to E.164 internally. */
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

  const normalized = toE164(to);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PHONE',
        twilioCode: undefined,
        message: 'Phone number cannot be normalized to E.164',
      },
    };
  }

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
      to: `whatsapp:${normalized}`,
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

/**
 * Sends a WhatsApp Content (template) message through Twilio's Messages API.
 *
 * A pre-approved Content template is addressed by `contentSid` and filled with
 * named `contentVariables`. No `body` is sent alongside `contentSid` — Twilio
 * ignores it for Content sends, and the LGPD consent footer applies to
 * free-form outbound messages only (design D9). Error codes from Twilio are
 * mapped to typed `TwilioSendError` variants (see `TWILIO_ERROR_MAP`).
 */
export async function sendTemplate(input: SendTemplateInput): Promise<SendTemplateResult> {
  const { to, templateKey, contentSid, variables } = input;

  const normalized = toE164(to);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PHONE',
        twilioCode: undefined,
        message: 'Phone number cannot be normalized to E.164',
      },
    };
  }

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

  try {
    const message = await client.messages.create({
      to: `whatsapp:${normalized}`,
      from: `whatsapp:${fromNumber}`,
      contentSid,
      contentVariables: JSON.stringify(variables),
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
        errorCode: sendError.code,
        twilioCode: sendError.twilioCode,
      },
      'Failed to send WhatsApp template message',
    );

    return { ok: false, error: sendError };
  }
}
