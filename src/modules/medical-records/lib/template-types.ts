/**
 * Template type definitions for clinical evolution notes.
 *
 * Each type corresponds to a therapeutic approach with its own
 * structured content schema. 'livre' and 'custom' are escape hatches
 * for approaches not yet modeled.
 */

// ---------------------------------------------------------------------------
// Template type union
// ---------------------------------------------------------------------------

export const TEMPLATE_TYPES = [
  'tcc',
  'psicanalise',
  'sistemica',
  'aba',
  'livre',
  'custom',
] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number];

// ---------------------------------------------------------------------------
// Select UI options (pt-BR labels)
// ---------------------------------------------------------------------------

export const TEMPLATE_OPTIONS: ReadonlyArray<{ value: TemplateType; label: string }> = [
  { value: 'tcc', label: 'Terapia Cognitivo-Comportamental (TCC)' },
  { value: 'psicanalise', label: 'Psicanálise' },
  { value: 'sistemica', label: 'Terapia Sistêmica' },
  { value: 'aba', label: 'Análise do Comportamento Aplicada (ABA)' },
  { value: 'livre', label: 'Livre' },
  { value: 'custom', label: 'Personalizado' },
] as const;
