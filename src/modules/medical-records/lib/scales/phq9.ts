import type { ClassificationResult, ScaleDefinition, ScaleOption, ScaleQuestion } from './types';

// TODO(clinical-review): canonical PHQ-9 Portuguese wording verification
// deferred to clinical review — only unambiguous diacritics added here.

// ---------------------------------------------------------------------------
// PHQ-9 response options (identical for all 9 items)
// ---------------------------------------------------------------------------

const PHQ9_OPTIONS: ScaleOption[] = [
  { value: 0, label: 'Nenhuma vez' },
  { value: 1, label: 'Vários dias' },
  { value: 2, label: 'Mais da metade dos dias' },
  { value: 3, label: 'Quase todos os dias' },
];

// ---------------------------------------------------------------------------
// The 9 official PHQ-9 items — standard Portuguese clinical wording
// ---------------------------------------------------------------------------

const PHQ9_QUESTIONS: ScaleQuestion[] = [
  {
    id: 'q1',
    prompt: 'Pouco interesse ou prazer em fazer as coisas',
    options: PHQ9_OPTIONS,
  },
  {
    id: 'q2',
    prompt: 'Se sentir para baixo, deprimido(a) ou sem perspectiva',
    options: PHQ9_OPTIONS,
  },
  {
    id: 'q3',
    prompt:
      'Dificuldade para pegar no sono ou permanecer dormindo, ou dormir mais do que de costume',
    options: PHQ9_OPTIONS,
  },
  {
    id: 'q4',
    prompt: 'Se sentir cansado(a) ou com pouca energia',
    options: PHQ9_OPTIONS,
  },
  {
    id: 'q5',
    prompt: 'Falta de apetite ou comendo demais',
    options: PHQ9_OPTIONS,
  },
  {
    id: 'q6',
    prompt:
      'Se sentir mal consigo mesmo(a) — ou achar que você é um fracasso ou que decepcionou sua família ou você mesmo(a)',
    options: PHQ9_OPTIONS,
  },
  {
    id: 'q7',
    prompt: 'Dificuldade para se concentrar nas coisas, como ler o jornal ou ver televisão',
    options: PHQ9_OPTIONS,
  },
  {
    id: 'q8',
    prompt:
      'Lentidão para se movimentar ou falar, a ponto das outras pessoas perceberem? Ou o contrário — ficar agitado(a) ou inquieto(a), andando de um lado para o outro mais do que de costume',
    options: PHQ9_OPTIONS,
  },
  {
    id: 'q9',
    prompt: 'Pensar em se ferir de alguma maneira ou que seria melhor estar morto(a)',
    options: PHQ9_OPTIONS,
  },
];

// ---------------------------------------------------------------------------
// Scoring — simple sum of the 9 responses (range 0-27)
// ---------------------------------------------------------------------------

function scorePHQ9(responses: Record<string, number>): number {
  let total = 0;
  for (const q of PHQ9_QUESTIONS) {
    total += responses[q.id] ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Classification thresholds (per design.md)
// ---------------------------------------------------------------------------

function classifyPHQ9(score: number | null): ClassificationResult {
  if (score === null) {
    return { label: 'Mínimo', severity: 'minimal' };
  }

  if (score <= 4) return { label: 'Mínimo', severity: 'minimal' };
  if (score <= 9) return { label: 'Leve', severity: 'mild' };
  if (score <= 14) return { label: 'Moderado', severity: 'moderate' };
  if (score <= 19) return { label: 'Moderadamente grave', severity: 'severe' };

  return { label: 'Grave', severity: 'severe' };
}

// ---------------------------------------------------------------------------
// Exported ScaleDefinition
// ---------------------------------------------------------------------------

export const phq9: ScaleDefinition = {
  key: 'phq9',
  label: 'PHQ-9 (Depressão)',
  description:
    'Patient Health Questionnaire — rastreamento e monitoramento da gravidade de sintomas depressivos.',
  estimatedMinutes: 3,
  questions: PHQ9_QUESTIONS,
  score: scorePHQ9,
  classify: classifyPHQ9,
};
