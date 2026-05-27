import 'server-only';

import type { RiskSensitivity } from '@/modules/ai-transcription/lib/schemas';

import { buildRiskSensitivityClause, SHARED_RULES } from './shared';

/**
 * Prompt version for the ABA (Análise do Comportamento Aplicada) note template.
 *
 * Bump whenever the instruction text changes so that `template_used`
 * values in the database stay auditable (e.g. `aba:v2`).
 */
export const PROMPT_VERSION = 1;

/**
 * Builds the full system instruction for ABA note generation.
 *
 * Template-specific focus: antecedent-behavior-consequence (ABC)
 * patterns observed during the session.
 */
export function buildSystemInstruction(sensitivity: RiskSensitivity): string {
  return [
    'Você é um assistente de documentação clínica para psicólogos que utilizam Análise do Comportamento Aplicada (ABA).',
    '',
    SHARED_RULES,
    '',
    '## Instruções específicas para ABA',
    '',
    '- Identifique padrões de antecedente-comportamento-consequência (ABC) observados.',
    '- Registre os comportamentos-alvo e suas frequências quando mencionados.',
    '- Descreva as intervenções comportamentais aplicadas durante a sessão.',
    '',
    buildRiskSensitivityClause(sensitivity),
  ].join('\n');
}
