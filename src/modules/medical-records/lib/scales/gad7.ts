import type { ClassificationResult, ScaleDefinition, ScaleOption, ScaleQuestion } from './types';

// ---------------------------------------------------------------------------
// GAD-7 response options (identical for all 7 items)
// ---------------------------------------------------------------------------

const GAD7_OPTIONS: ScaleOption[] = [
  { value: 0, label: 'Nenhuma vez' },
  { value: 1, label: 'Vários dias' },
  { value: 2, label: 'Mais da metade dos dias' },
  { value: 3, label: 'Quase todos os dias' },
];

// ---------------------------------------------------------------------------
// The 7 official GAD-7 items — standard Portuguese clinical wording
// ---------------------------------------------------------------------------

const GAD7_QUESTIONS: ScaleQuestion[] = [
  {
    id: 'q1',
    prompt: 'Sentir-se nervoso(a), ansioso(a) ou muito tenso(a)',
    options: GAD7_OPTIONS,
  },
  {
    id: 'q2',
    prompt: 'Não ser capaz de impedir ou de controlar as preocupações',
    options: GAD7_OPTIONS,
  },
  {
    id: 'q3',
    prompt: 'Preocupar-se muito com diversas coisas',
    options: GAD7_OPTIONS,
  },
  {
    id: 'q4',
    prompt: 'Dificuldade para relaxar',
    options: GAD7_OPTIONS,
  },
  {
    id: 'q5',
    prompt: 'Ficar tão inquieto(a) que é difícil ficar sentado(a)',
    options: GAD7_OPTIONS,
  },
  {
    id: 'q6',
    prompt: 'Ficar facilmente aborrecido(a) ou irritado(a)',
    options: GAD7_OPTIONS,
  },
  {
    id: 'q7',
    prompt: 'Sentir medo como se algo horrível pudesse acontecer',
    options: GAD7_OPTIONS,
  },
];

// ---------------------------------------------------------------------------
// Scoring — simple sum of the 7 responses (range 0-21)
// ---------------------------------------------------------------------------

function scoreGAD7(responses: Record<string, number>): number {
  let total = 0;
  for (const q of GAD7_QUESTIONS) {
    total += responses[q.id] ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Classification thresholds (per design.md)
// ---------------------------------------------------------------------------

function classifyGAD7(score: number | null): ClassificationResult {
  if (score === null) {
    return { label: 'Mínimo', severity: 'minimal' };
  }

  if (score <= 4) return { label: 'Mínimo', severity: 'minimal' };
  if (score <= 9) return { label: 'Leve', severity: 'mild' };
  if (score <= 14) return { label: 'Moderado', severity: 'moderate' };

  return { label: 'Grave', severity: 'severe' };
}

// ---------------------------------------------------------------------------
// Exported ScaleDefinition
// ---------------------------------------------------------------------------

export const gad7: ScaleDefinition = {
  key: 'gad7',
  label: 'GAD-7 (Ansiedade)',
  description:
    'Generalized Anxiety Disorder — rastreamento e monitoramento da gravidade de sintomas de ansiedade.',
  estimatedMinutes: 3,
  questions: GAD7_QUESTIONS,
  score: scoreGAD7,
  classify: classifyGAD7,
};
