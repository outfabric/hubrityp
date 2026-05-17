import type { ClassificationResult, ScaleDefinition, ScaleQuestion } from './types';

// ---------------------------------------------------------------------------
// AUDIT response options — vary per question group
// ---------------------------------------------------------------------------

// Questions 1-8: standard 5-point Likert (0-4)
// Questions 9-10: 3-point scale (0, 2, 4)
// Each question has its own clinically-appropriate labels.

// ---------------------------------------------------------------------------
// The 10 official AUDIT items — WHO Portuguese clinical wording
// ---------------------------------------------------------------------------

const AUDIT_QUESTIONS: ScaleQuestion[] = [
  {
    id: 'q1',
    prompt: 'Com que frequencia voce consome bebidas alcoolicas?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Mensalmente ou menos' },
      { value: 2, label: 'De 2 a 4 vezes por mes' },
      { value: 3, label: 'De 2 a 3 vezes por semana' },
      { value: 4, label: '4 ou mais vezes por semana' },
    ],
  },
  {
    id: 'q2',
    prompt: 'Quantas doses contendo alcool voce consome num dia tipico quando esta bebendo?',
    options: [
      { value: 0, label: '1 ou 2' },
      { value: 1, label: '3 ou 4' },
      { value: 2, label: '5 ou 6' },
      { value: 3, label: '7, 8 ou 9' },
      { value: 4, label: '10 ou mais' },
    ],
  },
  {
    id: 'q3',
    prompt: 'Com que frequencia voce consome seis ou mais doses de uma vez?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mes' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q4',
    prompt:
      'Com que frequencia, durante o ultimo ano, voce achou que nao era capaz de parar de beber uma vez que tinha comecado?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mes' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q5',
    prompt:
      'Com que frequencia, durante o ultimo ano, voce deixou de fazer o que era normalmente esperado por causa do uso de bebidas alcoolicas?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mes' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q6',
    prompt:
      'Com que frequencia, durante o ultimo ano, voce precisou de uma primeira dose pela manha para sentir-se melhor depois de uma grande bebedeira?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mes' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q7',
    prompt:
      'Com que frequencia, durante o ultimo ano, voce se sentiu culpado(a) ou com remorso depois de ter bebido?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mes' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q8',
    prompt:
      'Com que frequencia, durante o ultimo ano, voce nao conseguiu lembrar o que aconteceu na noite anterior porque tinha bebido?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mes' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q9',
    prompt: 'Voce ou outra pessoa ja se machucou pelo fato de voce ter bebido?',
    options: [
      { value: 0, label: 'Nao' },
      { value: 2, label: 'Sim, mas nao no ultimo ano' },
      { value: 4, label: 'Sim, no ultimo ano' },
    ],
  },
  {
    id: 'q10',
    prompt:
      'Algum parente, amigo, medico ou profissional da saude ja se preocupou com o fato de voce beber ou sugeriu que voce diminuisse?',
    options: [
      { value: 0, label: 'Nao' },
      { value: 2, label: 'Sim, mas nao no ultimo ano' },
      { value: 4, label: 'Sim, no ultimo ano' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Scoring — simple sum of the 10 responses (range 0-40)
// ---------------------------------------------------------------------------

function scoreAUDIT(responses: Record<string, number>): number {
  let total = 0;
  for (const q of AUDIT_QUESTIONS) {
    total += responses[q.id] ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Classification thresholds (per design.md)
// ---------------------------------------------------------------------------

function classifyAUDIT(score: number | null): ClassificationResult {
  if (score === null) {
    return { label: 'Baixo risco', severity: 'minimal' };
  }

  if (score <= 7) return { label: 'Baixo risco', severity: 'minimal' };
  if (score <= 15) return { label: 'Uso de risco', severity: 'mild' };
  if (score <= 19) return { label: 'Uso nocivo', severity: 'moderate' };

  return { label: 'Provavel dependencia', severity: 'severe' };
}

// ---------------------------------------------------------------------------
// Exported ScaleDefinition
// ---------------------------------------------------------------------------

export const audit: ScaleDefinition = {
  key: 'audit',
  label: 'AUDIT (Uso de Alcool)',
  description:
    'Alcohol Use Disorders Identification Test — rastreamento de uso problematico de alcool.',
  estimatedMinutes: 5,
  questions: AUDIT_QUESTIONS,
  score: scoreAUDIT,
  classify: classifyAUDIT,
};
