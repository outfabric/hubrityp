import 'server-only';

import { eq, sql as dsql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';
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
    variables: ['nome_paciente', 'nome_psicologo', 'data', 'dia_semana', 'hora', 'duracao_min', 'endereco', 'instrucao_chegada', 'link_confirmacao', 'valor'],
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Seeds the 6 default message templates for a psychologist.
 *
 * This is an internal function, NOT a public Server Action. It is called by
 * `completeTwilioConnectionImpl` after a successful WhatsApp connection.
 *
 * Idempotent: if templates already exist for the user, returns early without
 * inserting duplicates.
 */
export async function seedDefaultTemplates(userId: string): Promise<void> {
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

  // Insert all 6 default templates in a transaction
  await db.transaction(async (tx) => {
    for (const template of DEFAULT_TEMPLATES) {
      await tx.insert(messageTemplates).values({
        userId,
        templateKey: template.templateKey,
        body: template.body,
        variables: template.variables,
        metaTemplateId: null,
        metaStatus: 'pending',
        isDefault: true,
      });
    }
  });

  logger.info(
    { event: 'seed_templates_complete', userId, count: DEFAULT_TEMPLATES.length },
    'default templates seeded successfully',
  );
}
