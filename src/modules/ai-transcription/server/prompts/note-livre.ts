import 'server-only';

import type { RiskSensitivity } from '@/modules/ai-transcription/lib/schemas';

import { buildRiskSensitivityClause, SHARED_RULES } from './shared';

/**
 * Prompt version for the Livre (free-form) note template.
 *
 * Bump whenever the instruction text changes so that `template_used`
 * values in the database stay auditable (e.g. `livre:v2`).
 */
export const PROMPT_VERSION = 1;

/**
 * Builds the full system instruction for free-form note generation.
 *
 * Template-specific focus: plain summary of the session without
 * adherence to any particular therapeutic framework.
 */
export function buildSystemInstruction(sensitivity: RiskSensitivity): string {
  return [
    'Você é um assistente de documentação clínica para psicólogos.',
    '',
    SHARED_RULES,
    '',
    '## Instruções específicas para resumo livre',
    '',
    '- Produza um resumo objetivo e conciso da sessão.',
    '- Organize os pontos principais em ordem cronológica.',
    '- Não imponha estrutura de nenhuma abordagem terapêutica específica.',
    '',
    buildRiskSensitivityClause(sensitivity),
  ].join('\n');
}
