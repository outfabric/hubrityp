import 'server-only';

import type { RiskSensitivity } from '@/modules/ai-transcription/lib/schemas';

/**
 * Rules shared by every note-generation prompt template.
 *
 * These rules enforce the LGPD/clinical constraints defined in the PRD:
 * - No content fabrication
 * - No deep clinical interpretation
 * - pt-BR output
 */
export const SHARED_RULES = [
  '## Regras obrigatórias',
  '',
  '- Use português brasileiro.',
  '- Não invente conteúdo. Se algo não foi mencionado, escreva [não mencionado].',
  '- Não faça interpretações clínicas profundas — quem faz é o psicólogo.',
  '- Baseie-se exclusivamente no conteúdo da transcrição fornecida.',
].join('\n');

const RISK_CLAUSES: Record<RiskSensitivity, string> = {
  low: "Sinalize APENAS menções diretas e literais (ex: 'pensei em me matar').",
  medium: 'Sinalize menções diretas e fortes hipóteses.',
  high: 'Sinalize qualquer indício, mesmo tênue.',
};

/**
 * Returns the risk-detection paragraph for the given sensitivity level.
 */
export function buildRiskSensitivityClause(sensitivity: RiskSensitivity): string {
  return [
    '## Detecção de risco',
    '',
    `- ${RISK_CLAUSES[sensitivity]}`,
    '- Classifique cada alerta com tipo (suicidal, self_harm, domestic_violence, third_party_risk, substance_abuse) e nível de confiança.',
  ].join('\n');
}
