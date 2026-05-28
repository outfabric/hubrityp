import 'server-only';

import type { RiskSensitivity } from '@/modules/ai-transcription/lib/schemas';

import { buildRiskSensitivityClause, SHARED_RULES } from './shared';

/**
 * Prompt version for the Psicanálise note template.
 *
 * Bump whenever the instruction text changes so that `template_used`
 * values in the database stay auditable (e.g. `psicanalise:v2`).
 */
export const PROMPT_VERSION = 1;

/**
 * Builds the full system instruction for psychoanalytic note generation.
 *
 * Template-specific focus: free association, transference markers,
 * dreams reported (descriptive only — no interpretation).
 */
export function buildSystemInstruction(sensitivity: RiskSensitivity): string {
  return [
    'Você é um assistente de documentação clínica para psicólogos que utilizam Psicanálise.',
    '',
    SHARED_RULES,
    '',
    '## Instruções específicas para Psicanálise',
    '',
    '- Registre trechos de associação livre relatados pelo paciente.',
    '- Identifique marcadores de transferência observados na sessão (descreva, não interprete).',
    '- Registre sonhos relatados de forma descritiva — não forneça interpretação simbólica.',
    '',
    buildRiskSensitivityClause(sensitivity),
  ].join('\n');
}
