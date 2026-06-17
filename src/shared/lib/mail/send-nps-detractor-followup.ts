import 'server-only';

import { hashEmail } from '@/shared/lib/hash-email';
import { logger } from '@/shared/lib/logger';

import { sendEmailViaResend, type SendEmailResult } from './resend';

const SUBJECT = 'Queremos ouvir você';

/**
 * Detractor follow-up email body.
 *
 * Intentionally generic: it MUST contain no clinical content, no patient data,
 * and no echo of the psychologist's free-text NPS feedback (LGPD). It only
 * invites the recipient to share more about their experience.
 */
export function buildHtml(): string {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: sans-serif; color: #1a1a1a; line-height: 1.6;">
  <h2>Queremos ouvir você</h2>
  <p>Olá,</p>
  <p>Percebemos que sua experiência recente com o Hubrity pode não ter sido a melhor possível, e isso é muito importante para nós.</p>
  <p>Gostaríamos de entender o que podemos melhorar. Se puder, responda a este e-mail contando um pouco mais sobre o que não atendeu às suas expectativas.</p>
  <p>Seu retorno nos ajuda a construir uma plataforma melhor para psicólogos.</p>
  <br/>
  <p>— Equipe Hubrity</p>
</body>
</html>`.trim();
}

export function buildText(): string {
  return [
    'Queremos ouvir você',
    '',
    'Olá,',
    '',
    'Percebemos que sua experiência recente com o Hubrity pode não ter sido a melhor possível, e isso é muito importante para nós.',
    '',
    'Gostaríamos de entender o que podemos melhorar. Se puder, responda a este e-mail contando um pouco mais sobre o que não atendeu às suas expectativas.',
    '',
    'Seu retorno nos ajuda a construir uma plataforma melhor para psicólogos.',
    '',
    '— Equipe Hubrity',
  ].join('\n');
}

/**
 * Sends the NPS detractor follow-up email.
 *
 * In development without RESEND_API_KEY, logs a warning via pino and returns
 * `{ ok: true, skipped: true }`. Never throws.
 *
 * LGPD: the recipient address is never logged in cleartext — only its truncated
 * hash. The body carries no clinical content and no NPS feedback.
 */
export async function sendNpsDetractorFollowupEmail(to: string): Promise<SendEmailResult> {
  const result = await sendEmailViaResend({
    to,
    subject: SUBJECT,
    html: buildHtml(),
    text: buildText(),
  });

  const emailHash = hashEmail(to);

  if (!result.ok && result.error === 'no_api_key') {
    logger.warn(
      {
        event: 'mail.skipped',
        reason: 'no_api_key',
        template: 'nps-detractor-followup',
        emailHash,
      },
      '[dev] would send nps-detractor-followup email',
    );
    return { ok: true, skipped: true };
  }

  if (!result.ok) {
    logger.error(
      { event: 'mail.send_failed', template: 'nps-detractor-followup', emailHash },
      'Failed to send nps-detractor-followup email via Resend',
    );
  }

  return result;
}
