/**
 * Template variable dictionary — fixed set of 12 variables available for
 * WhatsApp message templates.
 *
 * Each entry carries metadata: a human-readable label, an example value
 * (used in UI previews), and the list of template types where the
 * variable appears in the default body.
 *
 * @see PRD RF-04.08
 */

import type { TemplateKey } from './template-key-schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateVariable {
  key: string;
  label: string;
  example: string;
  applicableTemplates: readonly TemplateKey[];
}

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------

/**
 * The 12 valid template variables from PRD RF-04.08.
 *
 * `applicableTemplates` lists the template keys whose default body
 * references this variable. Psychologists may still manually insert any
 * valid variable into any template body — this field is informational
 * (used for autocomplete hints and documentation).
 */
export const TEMPLATE_VARIABLES = [
  {
    key: 'nome_paciente',
    label: 'Nome do paciente',
    example: 'Maria',
    applicableTemplates: [
      'lembrete_24h',
      'lembrete_2h',
      'confirmacao_recebida',
      'cancelamento_aviso',
      'link_video',
      'termo_consentimento',
    ],
  },
  {
    key: 'nome_completo',
    label: 'Nome completo',
    example: 'Maria Silva',
    applicableTemplates: ['termo_consentimento'],
  },
  {
    key: 'nome_psicologo',
    label: 'Nome do psicólogo',
    example: 'Dra. Ana',
    applicableTemplates: [
      'lembrete_24h',
      'lembrete_2h',
      'confirmacao_recebida',
      'cancelamento_aviso',
      'link_video',
      'termo_consentimento',
    ],
  },
  {
    key: 'data',
    label: 'Data',
    example: 'amanhã',
    applicableTemplates: ['lembrete_24h', 'lembrete_2h', 'cancelamento_aviso'],
  },
  {
    key: 'dia_semana',
    label: 'Dia da semana',
    example: 'quinta-feira',
    applicableTemplates: ['lembrete_24h', 'lembrete_2h'],
  },
  {
    key: 'hora',
    label: 'Hora',
    example: '14:00',
    applicableTemplates: ['lembrete_24h', 'lembrete_2h', 'cancelamento_aviso'],
  },
  {
    key: 'duracao_min',
    label: 'Duração em minutos',
    example: '50',
    applicableTemplates: ['lembrete_24h'],
  },
  {
    key: 'endereco',
    label: 'Endereço',
    example: 'Rua Domingos de Morais, 2564',
    applicableTemplates: ['lembrete_24h'],
  },
  {
    key: 'instrucao_chegada',
    label: 'Instruções de chegada',
    example: 'Prédio cinza, interfone 42',
    applicableTemplates: ['lembrete_24h'],
  },
  {
    key: 'link_confirmacao',
    label: 'Link de confirmação',
    example: 'https://app.hubrityp.com.br/c/abc123',
    applicableTemplates: ['lembrete_24h', 'lembrete_2h'],
  },
  {
    key: 'link_video',
    label: 'Link de vídeo',
    example: 'https://meet.hubrityp.com.br/xyz',
    applicableTemplates: ['link_video'],
  },
  {
    key: 'valor',
    label: 'Valor',
    example: 'R$ 200,00',
    applicableTemplates: ['lembrete_24h', 'confirmacao_recebida'],
  },
] as const satisfies readonly TemplateVariable[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set of all valid variable keys — used by template-input-schema. */
export const VALID_VARIABLE_KEYS: ReadonlySet<string> = new Set(
  TEMPLATE_VARIABLES.map((v) => v.key),
);

/** Lookup a variable by key. Returns undefined if key is unknown. */
export function getVariableByKey(key: string): TemplateVariable | undefined {
  return TEMPLATE_VARIABLES.find((v) => v.key === key);
}
