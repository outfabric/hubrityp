import 'server-only';

import { eq, sql as dsql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { messageTemplates } from '@/shared/db/schema/whatsapp/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Default template definitions (PRD RF-04.06)
//
// Section 7 will populate these with the full template bodies. For now, they
// are placeholders that satisfy the schema constraints and allow the
// complete-twilio-connection flow to work end-to-end.
// ---------------------------------------------------------------------------

interface DefaultTemplate {
  templateKey: string;
  body: string;
  variables: string[];
}

const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    templateKey: 'lembrete_24h',
    body: 'Ola {nome_paciente}, este e um lembrete da sua sessao com {nome_psicologo} amanha ({dia_semana}), {data} as {hora}. Duracao: {duracao_min} min. Local: {endereco}. {instrucao_chegada}. Confirme: {link_confirmacao}. Valor: {valor}.',
    variables: ['nome_paciente', 'nome_psicologo', 'dia_semana', 'data', 'hora', 'duracao_min', 'endereco', 'instrucao_chegada', 'link_confirmacao', 'valor'],
  },
  {
    templateKey: 'lembrete_2h',
    body: 'Ola {nome_paciente}, sua sessao com {nome_psicologo} e hoje as {hora}. Confirme: {link_confirmacao}.',
    variables: ['nome_paciente', 'nome_psicologo', 'hora', 'link_confirmacao'],
  },
  {
    templateKey: 'confirmacao_recebida',
    body: 'Obrigado, {nome_paciente}! Sua presenca esta confirmada com {nome_psicologo}. Valor: {valor}.',
    variables: ['nome_paciente', 'nome_psicologo', 'valor'],
  },
  {
    templateKey: 'cancelamento_aviso',
    body: 'Ola {nome_paciente}, sua sessao com {nome_psicologo} em {data} as {hora} foi cancelada.',
    variables: ['nome_paciente', 'nome_psicologo', 'data', 'hora'],
  },
  {
    templateKey: 'link_video',
    body: 'Ola {nome_paciente}, sua sessao online com {nome_psicologo} esta prestes a comecar. Acesse: {link_video}.',
    variables: ['nome_paciente', 'nome_psicologo', 'link_video'],
  },
  {
    templateKey: 'termo_consentimento',
    body: 'Ola {nome_completo}, {nome_psicologo} enviou um termo de consentimento para voce assinar.',
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
