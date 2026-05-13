import 'server-only';

import twilio from 'twilio';

// ---------------------------------------------------------------------------
// Twilio webhook signature validation
// ---------------------------------------------------------------------------

/**
 * Validates an incoming Twilio webhook request using HMAC-SHA1 signature
 * verification. This MUST be called on every incoming webhook request
 * before processing the payload — see Decision 3 in the design doc.
 *
 * @param authToken  - The Twilio Auth Token (from `serverEnv.TWILIO_AUTH_TOKEN`).
 * @param signature  - The `X-Twilio-Signature` header value from the request.
 * @param url        - The full URL (including query string) configured as the webhook endpoint.
 * @param params     - The parsed request body parameters (key-value pairs).
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  return twilio.validateRequest(authToken, signature, url, params);
}
