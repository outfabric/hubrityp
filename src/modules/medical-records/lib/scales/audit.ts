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
    prompt: 'Com que frequência você consome bebidas alcoólicas?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Mensalmente ou menos' },
      { value: 2, label: 'De 2 a 4 vezes por mês' },
      { value: 3, label: 'De 2 a 3 vezes por semana' },
      { value: 4, label: '4 ou mais vezes por semana' },
    ],
  },
  {
    id: 'q2',
    prompt: 'Quantas doses contendo álcool você consome num dia típico quando está bebendo?',
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
    prompt: 'Com que frequência você consome seis ou mais doses de uma vez?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mês' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q4',
    prompt:
      'Com que frequência, durante o último ano, você achou que não era capaz de parar de beber uma vez que tinha começado?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mês' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q5',
    prompt:
      'Com que frequência, durante o último ano, você deixou de fazer o que era normalmente esperado por causa do uso de bebidas alcoólicas?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mês' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q6',
    prompt:
      'Com que frequência, durante o último ano, você precisou de uma primeira dose pela manhã para sentir-se melhor depois de uma grande bebedeira?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mês' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q7',
    prompt:
      'Com que frequência, durante o último ano, você se sentiu culpado(a) ou com remorso depois de ter bebido?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mês' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q8',
    prompt:
      'Com que frequência, durante o último ano, você não conseguiu lembrar o que aconteceu na noite anterior porque tinha bebido?',
    options: [
      { value: 0, label: 'Nunca' },
      { value: 1, label: 'Menos do que uma vez ao mês' },
      { value: 2, label: 'Mensalmente' },
      { value: 3, label: 'Semanalmente' },
      { value: 4, label: 'Todos ou quase todos os dias' },
    ],
  },
  {
    id: 'q9',
    prompt: 'Você ou outra pessoa já se machucou pelo fato de você ter bebido?',
    options: [
      { value: 0, label: 'Não' },
      { value: 2, label: 'Sim, mas não no último ano' },
      { value: 4, label: 'Sim, no último ano' },
    ],
  },
  {
    id: 'q10',
    prompt:
      'Algum parente, amigo, médico ou profissional da saúde já se preocupou com o fato de você beber ou sugeriu que você diminuísse?',
    options: [
      { value: 0, label: 'Não' },
      { value: 2, label: 'Sim, mas não no último ano' },
      { value: 4, label: 'Sim, no último ano' },
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
  label: 'AUDIT (Uso de Álcool)',
  description:
    'Alcohol Use Disorders Identification Test — rastreamento de uso problemático de álcool.',
  estimatedMinutes: 5,
  questions: AUDIT_QUESTIONS,
  score: scoreAUDIT,
  classify: classifyAUDIT,
};
