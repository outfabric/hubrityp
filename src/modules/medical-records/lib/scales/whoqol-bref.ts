import type { ClassificationResult, ScaleDefinition, ScaleOption, ScaleQuestion } from './types';

// TODO(clinical-review): canonical WHOQOL-Bref Brazilian Portuguese wording
// verification deferred to clinical review — only unambiguous diacritics added here.

// ---------------------------------------------------------------------------
// WHOQOL-Bref response options
// The official instrument uses several 5-point Likert sets depending on the
// question group. For simplicity (as allowed by spec), we use a standard
// satisfaction set for most items and a frequency/intensity set where the
// official wording requires it. Items 1-2 are the general facets (QoL and
// health perception); items 3-26 map to the four domains.
// ---------------------------------------------------------------------------

const OPTIONS_SATISFACTION: ScaleOption[] = [
  { value: 1, label: 'Muito insatisfeito' },
  { value: 2, label: 'Insatisfeito' },
  { value: 3, label: 'Nem satisfeito nem insatisfeito' },
  { value: 4, label: 'Satisfeito' },
  { value: 5, label: 'Muito satisfeito' },
];

const OPTIONS_INTENSITY: ScaleOption[] = [
  { value: 1, label: 'Nada' },
  { value: 2, label: 'Muito pouco' },
  { value: 3, label: 'Mais ou menos' },
  { value: 4, label: 'Bastante' },
  { value: 5, label: 'Extremamente' },
];

const OPTIONS_CAPACITY: ScaleOption[] = [
  { value: 1, label: 'Muito ruim' },
  { value: 2, label: 'Ruim' },
  { value: 3, label: 'Nem ruim nem bom' },
  { value: 4, label: 'Bom' },
  { value: 5, label: 'Muito bom' },
];

const OPTIONS_FREQUENCY: ScaleOption[] = [
  { value: 1, label: 'Nunca' },
  { value: 2, label: 'Algumas vezes' },
  { value: 3, label: 'Frequentemente' },
  { value: 4, label: 'Muito frequentemente' },
  { value: 5, label: 'Sempre' },
];

const OPTIONS_COMPLETENESS: ScaleOption[] = [
  { value: 1, label: 'Nada' },
  { value: 2, label: 'Muito pouco' },
  { value: 3, label: 'Médio' },
  { value: 4, label: 'Muito' },
  { value: 5, label: 'Completamente' },
];

// ---------------------------------------------------------------------------
// Domain item mapping (per spec)
// Physical:        items 3, 4, 10, 15, 16, 17, 18
// Psychological:   items 5, 6, 7, 11, 19, 26
// Social:          items 20, 21, 22
// Environmental:   items 8, 9, 12, 13, 14, 23, 24, 25
//
// Items 1, 2 are general QoL/health facets (not in any domain).
// Reverse-scored items: 3, 4, 26 (value -> 6 - value).
// ---------------------------------------------------------------------------

const PHYSICAL_ITEMS = ['q3', 'q4', 'q10', 'q15', 'q16', 'q17', 'q18'];
const PSYCHOLOGICAL_ITEMS = ['q5', 'q6', 'q7', 'q11', 'q19', 'q26'];
const SOCIAL_ITEMS = ['q20', 'q21', 'q22'];
const ENVIRONMENTAL_ITEMS = ['q8', 'q9', 'q12', 'q13', 'q14', 'q23', 'q24', 'q25'];

const REVERSE_ITEMS = new Set(['q3', 'q4', 'q26']);

// ---------------------------------------------------------------------------
// The 26 official WHOQOL-Bref items — Brazilian Portuguese version
// ---------------------------------------------------------------------------

const WHOQOL_QUESTIONS: ScaleQuestion[] = [
  // General facets (not in any domain)
  {
    id: 'q1',
    prompt: 'Como você avaliaria sua qualidade de vida?',
    options: OPTIONS_CAPACITY,
  },
  {
    id: 'q2',
    prompt: 'Quão satisfeito(a) você está com a sua saúde?',
    options: OPTIONS_SATISFACTION,
  },

  // Physical domain items
  {
    id: 'q3',
    prompt: 'Em que medida você acha que sua dor (física) impede você de fazer o que você precisa?',
    options: OPTIONS_INTENSITY,
    reverseScored: true,
  },
  {
    id: 'q4',
    prompt: 'O quanto você precisa de algum tratamento médico para levar sua vida diária?',
    options: OPTIONS_INTENSITY,
    reverseScored: true,
  },
  {
    id: 'q10',
    prompt: 'Você tem energia suficiente para seu dia a dia?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q15',
    prompt: 'Quão bem você é capaz de se locomover?',
    options: OPTIONS_CAPACITY,
  },
  {
    id: 'q16',
    prompt: 'Quão satisfeito(a) você está com o seu sono?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q17',
    prompt:
      'Quão satisfeito(a) você está com sua capacidade de desempenhar as atividades do seu dia a dia?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q18',
    prompt: 'Quão satisfeito(a) você está com sua capacidade para o trabalho?',
    options: OPTIONS_SATISFACTION,
  },

  // Psychological domain items
  {
    id: 'q5',
    prompt: 'O quanto você aproveita a vida?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q6',
    prompt: 'Em que medida você acha que a sua vida tem sentido?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q7',
    prompt: 'O quanto você consegue se concentrar?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q11',
    prompt: 'Você é capaz de aceitar sua aparência física?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q19',
    prompt: 'Quão satisfeito(a) você está consigo mesmo(a)?',
    options: OPTIONS_SATISFACTION,
  },

  // Social domain items
  {
    id: 'q20',
    prompt:
      'Quão satisfeito(a) você está com suas relações pessoais (amigos, parentes, conhecidos, colegas)?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q21',
    prompt: 'Quão satisfeito(a) você está com sua vida sexual?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q22',
    prompt: 'Quão satisfeito(a) você está com o apoio que você recebe de seus amigos?',
    options: OPTIONS_SATISFACTION,
  },

  // Environmental domain items
  {
    id: 'q8',
    prompt: 'Quão seguro(a) você se sente em sua vida diária?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q9',
    prompt: 'Quão saudável é o seu ambiente físico (clima, barulho, poluição, atrativos)?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q12',
    prompt: 'Você tem dinheiro suficiente para satisfazer suas necessidades?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q13',
    prompt: 'Quão disponíveis para você estão as informações que precisa no seu dia a dia?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q14',
    prompt: 'Em que medida você tem oportunidades de atividade de lazer?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q23',
    prompt: 'Quão satisfeito(a) você está com as condições do local onde mora?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q24',
    prompt: 'Quão satisfeito(a) você está com o seu acesso aos serviços de saúde?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q25',
    prompt: 'Quão satisfeito(a) você está com o seu meio de transporte?',
    options: OPTIONS_SATISFACTION,
  },

  // Psychological domain (remaining item)
  {
    id: 'q26',
    prompt:
      'Com que frequência você tem sentimentos negativos tais como mau humor, desespero, ansiedade, depressão?',
    options: OPTIONS_FREQUENCY,
    reverseScored: true,
  },
];

// ---------------------------------------------------------------------------
// Domain score computation
//
// 1. Reverse-score items 3, 4, 26: value -> 6 - value
// 2. Compute domain mean from its items
// 3. Transform to 0-100: ((mean - 1) / 4) * 100, rounded to integer
//    Equivalently: raw mean * 4 yields 4-20 range, then ((raw*4 - 4)/16)*100
// ---------------------------------------------------------------------------

function itemValue(id: string, raw: number): number {
  return REVERSE_ITEMS.has(id) ? 6 - raw : raw;
}

function domainScore(items: string[], responses: Record<string, number>): number {
  let sum = 0;
  for (const id of items) {
    const raw = responses[id] ?? 1;
    sum += itemValue(id, raw);
  }
  const mean = sum / items.length;
  // Transform to 0-100 scale
  return Math.round(((mean - 1) / 4) * 100);
}

// ---------------------------------------------------------------------------
// Scoring — WHOQOL-Bref has no single total score
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function scoreWHOQOL(_responses: Record<string, number>): null {
  return null;
}

// ---------------------------------------------------------------------------
// Classification — returns per-domain scores as JSON-stringified label
// (design.md decision #6: classification column stores JSON-stringified
// domain object for whoqol-bref)
// ---------------------------------------------------------------------------

function classifyWHOQOL(
  _score: number | null,
  responses?: Record<string, number>,
): ClassificationResult {
  const resp = responses ?? {};
  const domains = {
    physical: domainScore(PHYSICAL_ITEMS, resp),
    psychological: domainScore(PSYCHOLOGICAL_ITEMS, resp),
    social: domainScore(SOCIAL_ITEMS, resp),
    environmental: domainScore(ENVIRONMENTAL_ITEMS, resp),
  };

  return {
    label: JSON.stringify(domains),
    severity: 'domains',
  };
}

// ---------------------------------------------------------------------------
// Exported ScaleDefinition
// ---------------------------------------------------------------------------

export const whoqolBref: ScaleDefinition = {
  key: 'whoqol-bref',
  label: 'WHOQOL-Bref (Qualidade de Vida)',
  description:
    'World Health Organization Quality of Life — avaliacao da qualidade de vida em quatro dominios: fisico, psicologico, relacoes sociais e meio ambiente.',
  estimatedMinutes: 10,
  questions: WHOQOL_QUESTIONS,
  score: scoreWHOQOL,
  classify: classifyWHOQOL,
};

// Exported for unit tests to verify domain membership
export const WHOQOL_DOMAINS = {
  physical: PHYSICAL_ITEMS,
  psychological: PSYCHOLOGICAL_ITEMS,
  social: SOCIAL_ITEMS,
  environmental: ENVIRONMENTAL_ITEMS,
} as const;
