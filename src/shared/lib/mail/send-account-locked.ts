import 'server-only';

import { hashEmail } from '@/shared/lib/hash-email';
import { logger } from '@/shared/lib/logger';

import { sendEmailViaResend, type SendEmailResult } from './resend';

const SUBJECT = 'Sua conta foi temporariamente bloqueada';

function buildHtml(recipientEmail: string): string {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; color: #1a1a1a; line-height: 1.6;">
  <h2>Sua conta foi temporariamente bloqueada</h2>
  <p>Olá,</p>
  <p>Detectamos várias tentativas de login mal-sucedidas na conta associada a <strong>${recipientEmail}</strong>.</p>
  <p>Por segurança, sua conta foi bloqueada temporariamente. Você poderá tentar novamente após o período de espera.</p>
  <p>Se você não reconhece essas tentativas, recomendamos alterar sua senha assim que o acesso for restabelecido.</p>
  <br/>
  <p>— Equipe HubrityP</p>
</body>
</html>`.trim();
}

function buildText(recipientEmail: string): string {
  return [
    'Sua conta foi temporariamente bloqueada',
    '',
    'Olá,',
    '',
    `Detectamos várias tentativas de login mal-sucedidas na conta associada a ${recipientEmail}.`,
    '',
    'Por segurança, sua conta foi bloqueada temporariamente. Você poderá tentar novamente após o período de espera.',
    '',
    'Se você não reconhece essas tentativas, recomendamos alterar sua senha assim que o acesso for restabelecido.',
    '',
    '— Equipe HubrityP',
  ].join('\n');
}

/**
 * Sends an "account locked" notification email.
 *
 * In development without RESEND_API_KEY, logs a warning via pino and returns
 * `{ ok: true, skipped: true }`. Never throws.
 */
export async function sendAccountLockedEmail(to: string): Promise<SendEmailResult> {
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
      '[dev] would send account-locked email',
    );
    return { ok: true, skipped: true };
  }

  if (!result.ok) {
    logger.error(
      { event: 'mail.send_failed', template: 'account-locked', emailHash },
      'Failed to send account-locked email via Resend',
    );
  }

  return result;
}
