import 'server-only';

import { eq, sql as dsql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Default template definitions (PRD RF-04.06)
//
// Bodies use `{variable}` format (not `{{1}}`). Variables are automatically
// extracted from the body via regex — the `variables` array must match.
// ---------------------------------------------------------------------------

interface DefaultTemplate {
  templateKey: string;
  body: string;
  variables: string[];
}

const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    templateKey: 'lembrete_24h',
    body: 'Olá, {nome_paciente}! Lembrando da sua sessão com {nome_psicologo} amanhã, {data} ({dia_semana}), às {hora}. Duração: {duracao_min} min. Local: {endereco}. {instrucao_chegada}. Confirme: {link_confirmacao}. Valor: {valor}',
    variables: [
      'nome_paciente',
      'nome_psicologo',
      'data',
      'dia_semana',
      'hora',
      'duracao_min',
      'endereco',
      'instrucao_chegada',
      'link_confirmacao',
      'valor',
    ],
  },
  {
    templateKey: 'lembrete_2h',
    body: 'Olá, {nome_paciente}! Sua sessão com {nome_psicologo} é em 2 horas, às {hora} ({dia_semana}). Confirme: {link_confirmacao}',
    variables: ['nome_paciente', 'nome_psicologo', 'hora', 'dia_semana', 'link_confirmacao'],
  },
  {
    templateKey: 'confirmacao_recebida',
    body: 'Obrigado, {nome_paciente}! Sua presença na sessão com {nome_psicologo} está confirmada. Valor: {valor}',
    variables: ['nome_paciente', 'nome_psicologo', 'valor'],
  },
  {
    templateKey: 'cancelamento_aviso',
    body: 'Olá, {nome_paciente}. Informamos que sua sessão com {nome_psicologo} em {data}, às {hora}, foi cancelada.',
    variables: ['nome_paciente', 'nome_psicologo', 'data', 'hora'],
  },
  {
    templateKey: 'link_video',
    body: 'Olá, {nome_paciente}! Sua sessão online com {nome_psicologo} começa em breve. Acesse: {link_video}',
    variables: ['nome_paciente', 'nome_psicologo', 'link_video'],
  },
  {
    templateKey: 'termo_consentimento',
    body: 'Olá, {nome_completo}. {nome_psicologo} enviou o Termo de Consentimento para assinatura.',
    variables: ['nome_completo', 'nome_psicologo'],
  },
] as const;

// ---------------------------------------------------------------------------
// Platform Content SID mapping (shared-number model)
//
// In the shared-number model the platform registers the reminder templates
// once in the shared Twilio WABA. Every psychologist reuses the same approved
// Content SIDs, so seeding stamps each reminder template with its platform SID
// (`metaTemplateId`) and marks it `approved` — that is what lets the reminders
// dispatcher send immediately after provisioning (`fetchTemplate` returns the
// `contentSid` only when `metaTemplateId` is non-null).
//
// `termo_consentimento` is NOT a reminder template and has no platform SID; it
// stays `pending` with a null `metaTemplateId`.
// ---------------------------------------------------------------------------

/**
 * Returns the platform Content SID for a reminder `templateKey`, or `null` for
 * templates that are not seeded with a platform SID (e.g. `termo_consentimento`).
 */
function resolvePlatformContentSid(templateKey: string): string | null {
  switch (templateKey) {
    case 'lembrete_24h':
      return serverEnv.TWILIO_CONTENT_SID_LEMBRETE_24H;
    case 'lembrete_2h':
      return serverEnv.TWILIO_CONTENT_SID_LEMBRETE_2H;
    case 'link_video':
      return serverEnv.TWILIO_CONTENT_SID_LINK_VIDEO;
    case 'confirmacao_recebida':
      return serverEnv.TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA;
    case 'cancelamento_aviso':
      return serverEnv.TWILIO_CONTENT_SID_CANCELAMENTO_AVISO;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Seeds the 6 default message templates for a psychologist.
 *
 * @internal Only call from completeTwilioConnectionImpl after auth.
 *
 * This is an internal function, NOT a public Server Action. It is called by
 * `completeTwilioConnectionImpl` after a successful WhatsApp connection.
 *
 * Idempotent: if templates already exist for the user, returns early without
 * inserting duplicates.
 */
export async function seedDefaultTemplates(userId: string): Promise<void> {
  z.string().uuid().parse(userId);
  // Check if templates already exist for this user
  const existingCount = await db
    .select({ count: dsql<number>`count(*)::int` })
    .from(messageTemplates)
    .where(eq(messageTemplates.userId, userId));

  const count = existingCount[0]?.count ?? 0;

  if (count > 0) {
    logger.info(
      { event: 'seed_templates_skipped', userId, existingCount: count },
      'templates already exist for user, skipping seed',
    );
    return;
  }

  // Insert all 6 default templates in a transaction. Reminder templates are
  // stamped with the platform Content SID + `approved`; non-reminder templates
  // (e.g. `termo_consentimento`) stay `pending` with a null SID.
  await db.transaction(async (tx) => {
    for (const template of DEFAULT_TEMPLATES) {
      const contentSid = resolvePlatformContentSid(template.templateKey);

      await tx.insert(messageTemplates).values({
        userId,
        templateKey: template.templateKey,
        body: template.body,
        variables: template.variables,
        metaTemplateId: contentSid,
        metaStatus: contentSid ? 'approved' : 'pending',
        isDefault: true,
      });
    }
  });

  logger.info(
    { event: 'seed_templates_complete', userId, count: DEFAULT_TEMPLATES.length },
    'default templates seeded successfully',
  );
}
