import type { ClassificationResult, ScaleDefinition, ScaleOption, ScaleQuestion } from './types';

// ---------------------------------------------------------------------------
// SDQ response options (identical for all 25 items)
// 0 = Falso, 1 = Mais ou menos verdadeiro, 2 = Verdadeiro
// ---------------------------------------------------------------------------

const SDQ_OPTIONS: ScaleOption[] = [
  { value: 0, label: 'Falso' },
  { value: 1, label: 'Mais ou menos verdadeiro' },
  { value: 2, label: 'Verdadeiro' },
];

// ---------------------------------------------------------------------------
// Subscale item mapping (standard SDQ)
// Emotional problems:   items 3, 8, 13, 16, 24
// Conduct problems:     items 5, 7, 12, 18, 22
// Hyperactivity:        items 2, 10, 15, 21, 25
// Peer problems:        items 6, 11, 14, 19, 23
// Prosocial:            items 1, 4, 9, 17, 20
// ---------------------------------------------------------------------------

const EMOTIONAL_ITEMS = ['q3', 'q8', 'q13', 'q16', 'q24'];
const CONDUCT_ITEMS = ['q5', 'q7', 'q12', 'q18', 'q22'];
const HYPERACTIVITY_ITEMS = ['q2', 'q10', 'q15', 'q21', 'q25'];
const PEER_ITEMS = ['q6', 'q11', 'q14', 'q19', 'q23'];
const PROSOCIAL_ITEMS = ['q1', 'q4', 'q9', 'q17', 'q20'];

// Standard SDQ reverse-scored items within the difficulties subscales
// (items 7, 11, 14, 21, 25 — scored as 2 - value for their subscale)
const DIFFICULTIES_REVERSE_ITEMS = new Set(['q7', 'q11', 'q14', 'q21', 'q25']);

// ---------------------------------------------------------------------------
// The 25 official SDQ self-report items — Portuguese version (11-17 years)
// Prosocial items (1, 4, 9, 17, 20) are marked reverseScored per spec.
// ---------------------------------------------------------------------------

const SDQ_QUESTIONS: ScaleQuestion[] = [
  {
    id: 'q1',
    prompt: 'Eu tento ser gentil com as outras pessoas. Me preocupo com os sentimentos delas',
    options: SDQ_OPTIONS,
    reverseScored: true,
  },
  {
    id: 'q2',
    prompt: 'Eu sou inquieto(a), nao consigo ficar parado(a) por muito tempo',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q3',
    prompt: 'Eu tenho muitas dores de cabeca, de estomago ou enjoo',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q4',
    prompt: 'Eu geralmente compartilho com os outros (comida, jogos, canetas, etc.)',
    options: SDQ_OPTIONS,
    reverseScored: true,
  },
  {
    id: 'q5',
    prompt: 'Eu fico muito bravo(a) e frequentemente perco a paciencia',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q6',
    prompt: 'Eu prefiro ficar sozinho(a) do que com pessoas da minha idade',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q7',
    prompt: 'Eu geralmente faco o que me mandam',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q8',
    prompt: 'Eu me preocupo muito',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q9',
    prompt: 'Eu ajudo quando alguem se machuca, fica triste ou se sente mal',
    options: SDQ_OPTIONS,
    reverseScored: true,
  },
  {
    id: 'q10',
    prompt: 'Eu fico mexendo muito as maos ou os pes ou me revirando na cadeira',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q11',
    prompt: 'Eu tenho pelo menos um(a) bom(boa) amigo(a)',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q12',
    prompt: 'Eu brigo muito. Eu consigo fazer as outras pessoas fazerem o que eu quero',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q13',
    prompt: 'Eu me sinto infeliz, triste ou com vontade de chorar',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q14',
    prompt: 'As outras pessoas da minha idade geralmente gostam de mim',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q15',
    prompt: 'Eu me distraio com facilidade, acho dificil me concentrar',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q16',
    prompt: 'Eu fico nervoso(a) em situacoes novas. Eu facilmente perco a confianca em mim',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q17',
    prompt: 'Eu sou gentil com criancas mais novas',
    options: SDQ_OPTIONS,
    reverseScored: true,
  },
  {
    id: 'q18',
    prompt: 'Eu sou frequentemente acusado(a) de mentir ou trapacear',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q19',
    prompt: 'Outras criancas ou jovens me perseguem, ameacam ou intimidam',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q20',
    prompt: 'Eu frequentemente me ofereco para ajudar os outros (pais, professores, criancas)',
    options: SDQ_OPTIONS,
    reverseScored: true,
  },
  {
    id: 'q21',
    prompt: 'Eu penso antes de fazer as coisas',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q22',
    prompt: 'Eu pego coisas que nao sao minhas, de casa, da escola ou de outros lugares',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q23',
    prompt: 'Eu me dou melhor com adultos do que com pessoas da minha idade',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q24',
    prompt: 'Eu tenho muitos medos, eu me assusto facilmente',
    options: SDQ_OPTIONS,
  },
  {
    id: 'q25',
    prompt: 'Eu termino as tarefas que comeco. Eu tenho boa atencao',
    options: SDQ_OPTIONS,
  },
];

// ---------------------------------------------------------------------------
// Scoring — total difficulties = emotional + conduct + hyperactivity + peer
// Prosocial subscale is NOT included in the total difficulties score.
// Items 7, 11, 14, 21, 25 are reverse-scored within their subscale
// (value -> 2 - value) per standard SDQ scoring manual.
// ---------------------------------------------------------------------------

/** Returns the effective value for a difficulties item, applying reverse scoring where needed. */
function difficultiesItemValue(id: string, raw: number): number {
  return DIFFICULTIES_REVERSE_ITEMS.has(id) ? 2 - raw : raw;
}

/** Sum a subscale, applying reverse scoring for within-difficulties reversed items. */
function subscaleSum(items: string[], responses: Record<string, number>): number {
  let sum = 0;
  for (const id of items) {
    const raw = responses[id] ?? 0;
    sum += difficultiesItemValue(id, raw);
  }
  return sum;
}

function scoreSDQ(responses: Record<string, number>): number {
  // Total difficulties = emotional + conduct + hyperactivity + peer (NOT prosocial)
  return (
    subscaleSum(EMOTIONAL_ITEMS, responses) +
    subscaleSum(CONDUCT_ITEMS, responses) +
    subscaleSum(HYPERACTIVITY_ITEMS, responses) +
    subscaleSum(PEER_ITEMS, responses)
  );
}

// ---------------------------------------------------------------------------
// Classification thresholds (self-report 11-17)
// 0-15: Normal (minimal), 16-19: Limitrofe (mild), 20-40: Anormal (severe)
// ---------------------------------------------------------------------------

function classifySDQ(score: number | null): ClassificationResult {
  if (score === null) {
    return { label: 'Normal', severity: 'minimal' };
  }

  if (score <= 15) return { label: 'Normal', severity: 'minimal' };
  if (score <= 19) return { label: 'Limitrofe', severity: 'mild' };

  return { label: 'Anormal', severity: 'severe' };
}

// ---------------------------------------------------------------------------
// Exported ScaleDefinition
// ---------------------------------------------------------------------------

export const sdq: ScaleDefinition = {
  key: 'sdq',
  label: 'SDQ (Capacidades e Dificuldades)',
  description:
    'Strengths and Difficulties Questionnaire — Versao autoaplicavel para adolescentes de 11 a 17 anos.',
  estimatedMinutes: 10,
  questions: SDQ_QUESTIONS,
  score: scoreSDQ,
  classify: classifySDQ,
};

// Exported for unit tests to verify subscale membership
export const SDQ_SUBSCALES = {
  emotional: EMOTIONAL_ITEMS,
  conduct: CONDUCT_ITEMS,
  hyperactivity: HYPERACTIVITY_ITEMS,
  peer: PEER_ITEMS,
  prosocial: PROSOCIAL_ITEMS,
} as const;
