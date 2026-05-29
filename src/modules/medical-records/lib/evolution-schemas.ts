import { z } from 'zod';

import { TEMPLATE_TYPES, type TemplateType } from './template-types';

/**
 * Zod schemas for evolution note content by template type, plus
 * create/update input validation.
 *
 * Required fields are enforced on creation; `.optional()` is used on
 * fields that may be absent in legacy JSONB rows so reads degrade
 * gracefully (RN from design.md).
 */

// ---------------------------------------------------------------------------
// Task anterior status enum (TCC-specific)
// ---------------------------------------------------------------------------

const TAREFA_ANTERIOR_STATUS = ['sim', 'parcial', 'nao'] as const;

// ---------------------------------------------------------------------------
// Per-template content schemas
// ---------------------------------------------------------------------------

/**
 * TCC: Terapia Cognitivo-Comportamental.
 * humor_inicial is required — Zod rejects when missing.
 */
export const tccContentSchema = z.object({
  humor_inicial: z
    .number({ message: 'humor_inicial é obrigatório.' })
    .int()
    .min(0, { message: 'humor_inicial deve ser entre 0 e 10.' })
    .max(10, { message: 'humor_inicial deve ser entre 0 e 10.' }),
  humor_final: z
    .number({ message: 'humor_final é obrigatório.' })
    .int()
    .min(0, { message: 'humor_final deve ser entre 0 e 10.' })
    .max(10, { message: 'humor_final deve ser entre 0 e 10.' }),
  pauta_sessao: z.string().min(1, { message: 'pauta_sessao é obrigatório.' }),
  conteudo_trabalhado: z.string().min(1, { message: 'conteudo_trabalhado é obrigatório.' }),
  tarefa_casa_atribuida: z.string().min(1, { message: 'tarefa_casa_atribuida é obrigatório.' }),
  tarefa_anterior_status: z.enum(TAREFA_ANTERIOR_STATUS, {
    message: 'tarefa_anterior_status deve ser sim, parcial ou nao.',
  }),
  proximos_passos: z.string().min(1, { message: 'proximos_passos é obrigatório.' }),
});

/**
 * Psicanálise: all fields are rich text.
 */
export const psicanaliseContentSchema = z.object({
  conteudo_manifesto: z.string().min(1, { message: 'conteudo_manifesto é obrigatório.' }),
  associacoes_livres: z.string().min(1, { message: 'associacoes_livres é obrigatório.' }),
  sonhos_relatados: z.string().min(1, { message: 'sonhos_relatados é obrigatório.' }),
  transferencia_observada: z.string().min(1, { message: 'transferencia_observada é obrigatório.' }),
});

/**
 * Sistêmica: participants array + rich text fields.
 */
export const sistemicaContentSchema = z.object({
  participantes: z
    .array(z.string().min(1))
    .min(1, { message: 'participantes deve ter pelo menos 1 item.' }),
  conteudo_trabalhado: z.string().min(1, { message: 'conteudo_trabalhado é obrigatório.' }),
  padroes_observados: z.string().min(1, { message: 'padroes_observados é obrigatório.' }),
  intervencao_realizada: z.string().min(1, { message: 'intervencao_realizada é obrigatório.' }),
  tarefa_casa: z.string().min(1, { message: 'tarefa_casa é obrigatório.' }),
});

/**
 * ABA: Análise do Comportamento Aplicada — all rich text.
 */
export const abaContentSchema = z.object({
  comportamentos_alvo: z.string().min(1, { message: 'comportamentos_alvo é obrigatório.' }),
  linha_base: z.string().min(1, { message: 'linha_base é obrigatório.' }),
  abc: z.string().min(1, { message: 'abc é obrigatório.' }),
  reforcadores: z.string().min(1, { message: 'reforcadores é obrigatório.' }),
  foco_proxima: z.string().min(1, { message: 'foco_proxima é obrigatório.' }),
});

/**
 * Livre: single freeform rich text field.
 */
export const livreContentSchema = z.object({
  conteudo: z.string().min(1, { message: 'conteudo é obrigatório.' }),
});

/**
 * Custom: arbitrary JSONB, must be non-empty object.
 */
export const customContentSchema = z
  .record(z.string(), z.unknown())
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'Conteúdo personalizado não pode ser vazio.',
  });

// ---------------------------------------------------------------------------
// Content schema map (for runtime dispatch)
// ---------------------------------------------------------------------------

export const CONTENT_SCHEMA_MAP: Record<TemplateType, z.ZodType> = {
  tcc: tccContentSchema,
  psicanalise: psicanaliseContentSchema,
  sistemica: sistemicaContentSchema,
  aba: abaContentSchema,
  livre: livreContentSchema,
  custom: customContentSchema,
};

// ---------------------------------------------------------------------------
// Create evolution input schema
// ---------------------------------------------------------------------------

/**
 * Input for creating a new evolution note.
 * Content is validated separately per template type.
 */
export const createEvolutionInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID válido.' }),
  sessionId: z.string().uuid({ message: 'sessionId deve ser um UUID válido.' }).optional(),
  templateType: z.enum(TEMPLATE_TYPES, {
    message: 'templateType inválido.',
  }),
  content: z.unknown(),

  // AI-assist audit flags. Set when the evolution's initial content was
  // produced from an AI transcription that the psychologist reviewed and
  // saved. Both are optional so existing callers are unaffected; defaults
  // (false / null) are applied in the implementation, not here, to keep the
  // inferred input type honest about what callers may omit.
  aiAssisted: z.boolean().optional(),
  aiTranscriptionId: z
    .string()
    .uuid({ message: 'aiTranscriptionId deve ser um UUID válido.' })
    .nullable()
    .optional(),
});

export type CreateEvolutionInput = z.infer<typeof createEvolutionInputSchema>;

// ---------------------------------------------------------------------------
// Update evolution input schema
// ---------------------------------------------------------------------------

/**
 * Input for updating an existing evolution note.
 * When the update is an addendum (isAddendum=true), `reason` is required.
 */
export const updateEvolutionInputSchema = z
  .object({
    evolutionId: z.string().uuid({ message: 'evolutionId deve ser um UUID válido.' }),
    content: z.unknown(),
    isAddendum: z.boolean().optional().default(false),
    reason: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.isAddendum) {
        return typeof data.reason === 'string' && data.reason.trim().length > 0;
      }
      return true;
    },
    {
      message: 'reason é obrigatório quando a atualização é um adendo.',
      path: ['reason'],
    },
  );

export type UpdateEvolutionInput = z.infer<typeof updateEvolutionInputSchema>;
