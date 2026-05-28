import 'server-only';

import type { RiskSensitivity } from '@/modules/ai-transcription/lib/schemas';

import { buildRiskSensitivityClause, SHARED_RULES } from './shared';

/**
 * Prompt version for the TCC (Terapia Cognitivo-Comportamental) note template.
 *
 * Bump whenever the instruction text changes so that `template_used`
 * values in the database stay auditable (e.g. `tcc:v2`).
 */
export const PROMPT_VERSION = 1;

/**
 * Builds the full system instruction for TCC note generation.
 *
 * Template-specific focus: mood (0-10 scale), session agenda,
 * techniques worked, and homework.
 */
export function buildSystemInstruction(sensitivity: RiskSensitivity): string {
  return [
    'Você é um assistente de documentação clínica para psicólogos que utilizam Terapia Cognitivo-Comportamental (TCC).',
    '',
    SHARED_RULES,
    '',
    '## Instruções específicas para TCC',
    '',
    '- Identifique o humor inicial e final do paciente em uma escala de 0 a 10 (se mencionado).',
    '- Liste a pauta/agenda da sessão.',
    '- Descreva as técnicas cognitivo-comportamentais trabalhadas (reestruturação cognitiva, exposição, registro de pensamentos, etc.).',
    '- Liste as tarefas de casa (homework) combinadas para a próxima sessão.',
    '',
    buildRiskSensitivityClause(sensitivity),
  ].join('\n');
}
