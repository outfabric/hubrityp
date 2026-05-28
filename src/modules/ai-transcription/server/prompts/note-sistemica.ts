import 'server-only';

import type { RiskSensitivity } from '@/modules/ai-transcription/lib/schemas';

import { buildRiskSensitivityClause, SHARED_RULES } from './shared';

/**
 * Prompt version for the Sistêmica (Systemic Therapy) note template.
 *
 * Bump whenever the instruction text changes so that `template_used`
 * values in the database stay auditable (e.g. `sistemica:v2`).
 */
export const PROMPT_VERSION = 1;

/**
 * Builds the full system instruction for systemic therapy note generation.
 *
 * Template-specific focus: family and relational dynamics referenced
 * during the session.
 */
export function buildSystemInstruction(sensitivity: RiskSensitivity): string {
  return [
    'Você é um assistente de documentação clínica para psicólogos que utilizam Terapia Sistêmica.',
    '',
    SHARED_RULES,
    '',
    '## Instruções específicas para Terapia Sistêmica',
    '',
    '- Identifique e descreva dinâmicas familiares e relacionais referenciadas na sessão.',
    '- Registre padrões de comunicação, alianças e conflitos mencionados.',
    '- Descreva o contexto relacional sem emitir juízo de valor.',
    '',
    buildRiskSensitivityClause(sensitivity),
  ].join('\n');
}
