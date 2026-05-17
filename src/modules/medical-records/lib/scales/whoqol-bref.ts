import type { ClassificationResult, ScaleDefinition, ScaleOption, ScaleQuestion } from './types';

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
  { value: 3, label: 'Medio' },
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
    prompt: 'Como voce avaliaria sua qualidade de vida?',
    options: OPTIONS_CAPACITY,
  },
  {
    id: 'q2',
    prompt: 'Quao satisfeito(a) voce esta com a sua saude?',
    options: OPTIONS_SATISFACTION,
  },

  // Physical domain items
  {
    id: 'q3',
    prompt: 'Em que medida voce acha que sua dor (fisica) impede voce de fazer o que voce precisa?',
    options: OPTIONS_INTENSITY,
    reverseScored: true,
  },
  {
    id: 'q4',
    prompt: 'O quanto voce precisa de algum tratamento medico para levar sua vida diaria?',
    options: OPTIONS_INTENSITY,
    reverseScored: true,
  },
  {
    id: 'q10',
    prompt: 'Voce tem energia suficiente para seu dia a dia?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q15',
    prompt: 'Quao bem voce e capaz de se locomover?',
    options: OPTIONS_CAPACITY,
  },
  {
    id: 'q16',
    prompt: 'Quao satisfeito(a) voce esta com o seu sono?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q17',
    prompt:
      'Quao satisfeito(a) voce esta com sua capacidade de desempenhar as atividades do seu dia a dia?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q18',
    prompt: 'Quao satisfeito(a) voce esta com sua capacidade para o trabalho?',
    options: OPTIONS_SATISFACTION,
  },

  // Psychological domain items
  {
    id: 'q5',
    prompt: 'O quanto voce aproveita a vida?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q6',
    prompt: 'Em que medida voce acha que a sua vida tem sentido?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q7',
    prompt: 'O quanto voce consegue se concentrar?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q11',
    prompt: 'Voce e capaz de aceitar sua aparencia fisica?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q19',
    prompt: 'Quao satisfeito(a) voce esta consigo mesmo(a)?',
    options: OPTIONS_SATISFACTION,
  },

  // Social domain items
  {
    id: 'q20',
    prompt:
      'Quao satisfeito(a) voce esta com suas relacoes pessoais (amigos, parentes, conhecidos, colegas)?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q21',
    prompt: 'Quao satisfeito(a) voce esta com sua vida sexual?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q22',
    prompt: 'Quao satisfeito(a) voce esta com o apoio que voce recebe de seus amigos?',
    options: OPTIONS_SATISFACTION,
  },

  // Environmental domain items
  {
    id: 'q8',
    prompt: 'Quao seguro(a) voce se sente em sua vida diaria?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q9',
    prompt: 'Quao saudavel e o seu ambiente fisico (clima, barulho, poluicao, atrativos)?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q12',
    prompt: 'Voce tem dinheiro suficiente para satisfazer suas necessidades?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q13',
    prompt: 'Quao disponiveis para voce estao as informacoes que precisa no seu dia a dia?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q14',
    prompt: 'Em que medida voce tem oportunidades de atividade de lazer?',
    options: OPTIONS_COMPLETENESS,
  },
  {
    id: 'q23',
    prompt: 'Quao satisfeito(a) voce esta com as condicoes do local onde mora?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q24',
    prompt: 'Quao satisfeito(a) voce esta com o seu acesso aos servicos de saude?',
    options: OPTIONS_SATISFACTION,
  },
  {
    id: 'q25',
    prompt: 'Quao satisfeito(a) voce esta com o seu meio de transporte?',
    options: OPTIONS_SATISFACTION,
  },

  // Psychological domain (remaining item)
  {
    id: 'q26',
    prompt:
      'Com que frequencia voce tem sentimentos negativos tais como mau humor, desespero, ansiedade, depressao?',
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
