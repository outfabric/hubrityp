import 'server-only';

import { hashEmail } from '@/shared/lib/hash-email';
import { logger } from '@/shared/lib/logger';

import { sendEmailViaResend, type SendEmailResult } from './resend';

const SUBJECT = 'Sua senha foi alterada';

export function buildHtml(recipientEmail: string): string {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; color: #1a1a1a; line-height: 1.6;">
  <h2>Sua senha foi alterada</h2>
  <p>Olá,</p>
  <p>A senha da conta associada a <strong>${recipientEmail}</strong> foi alterada com sucesso.</p>
  <p>Se você não realizou essa alteração, entre em contato conosco imediatamente respondendo este e-mail.</p>
  <br/>
  <p>— Equipe Hubrity</p>
</body>
</html>`.trim();
}

export function buildText(recipientEmail: string): string {
  return [
    'Sua senha foi alterada',
    '',
    'Olá,',
    '',
    `A senha da conta associada a ${recipientEmail} foi alterada com sucesso.`,
    '',
    'Se você não realizou essa alteração, entre em contato conosco imediatamente respondendo este e-mail.',
    '',
    '— Equipe Hubrity',
  ].join('\n');
}

/**
 * Sends a "password changed" notification email.
 *
 * In development without RESEND_API_KEY, logs a warning via pino and returns
 * `{ ok: true, skipped: true }`. Never throws.
 */
export async function sendPasswordChangedEmail(to: string): Promise<SendEmailResult> {
  const result = await sendEmailViaResend({
    to,
    subject: SUBJECT,
    html: buildHtml(to),
    text: buildText(to),
  });

  const emailHash = hashEmail(to);

  if (!result.ok && result.error === 'no_api_key') {
    logger.warn(
      { event: 'mail.skipped', reason: 'no_api_key', emailHash },
      '[dev] would send password-changed email',
    );
    return { ok: true, skipped: true };
  }

  if (!result.ok) {
    logger.error(
      { event: 'mail.send_failed', template: 'password-changed', emailHash },
      'Failed to send password-changed email via Resend',
    );
  }

  return result;
}
