import 'server-only';

import { serverEnv } from '@/shared/env';

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Default `from` address for transactional emails.
 * Exported so unit tests can assert the brand display name and domain.
 */
export const DEFAULT_FROM = 'Hubrity <noreply@hubrity.com>';

export type SendEmailInput = {
  to: string;
  from?: string;
  subject: string;
  html: string;
  text?: string;
};

export type SendEmailResult =
  | { ok: true; skipped?: false; id: string }
  | { ok: true; skipped: true }
  | { ok: false; error: 'no_api_key' | 'send_failed' };

/**
 * Sends an email via the Resend HTTP API.
 *
 * Never throws — returns a discriminated union result instead.
 * In environments without RESEND_API_KEY, returns `{ ok: false, error: 'no_api_key' }`.
 */
export async function sendEmailViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = serverEnv.RESEND_API_KEY;

  if (!apiKey) {
    return { ok: false, error: 'no_api_key' };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from ?? DEFAULT_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      return { ok: false, error: 'send_failed' };
    }

    const data = (await response.json()) as { id: string };
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, error: 'send_failed' };
  }
}
