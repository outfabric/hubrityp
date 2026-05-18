import { z } from 'zod';

// ---------------------------------------------------------------------------
// Document type enum
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES = ['declaracao', 'atestado', 'relatorio', 'laudo', 'parecer'] as const;

export const documentTypeSchema = z.enum(DOCUMENT_TYPES, {
  message: 'document_type deve ser declaracao, atestado, relatorio, laudo ou parecer.',
});

export type DocumentType = z.infer<typeof documentTypeSchema>;

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const psychologistInfoSchema = z.object({
  name: z.string().min(1, { message: 'Nome do psicólogo é obrigatório.' }),
  crp: z.string().min(1, { message: 'CRP do psicólogo é obrigatório.' }),
  contact: z.string().optional(),
});

const localDataSchema = z.object({
  local: z.string().min(1, { message: 'Local é obrigatório.' }),
  data: z.string().min(1, { message: 'Data é obrigatória.' }),
});

const cid10EntrySchema = z.object({
  code: z.string().min(1, { message: 'Código CID-10 é obrigatório.' }),
  description: z.string().min(1, { message: 'Descrição do CID-10 é obrigatória.' }),
});

// ---------------------------------------------------------------------------
// Base content schema (shared fields across all document types)
// ---------------------------------------------------------------------------

/**
 * Common mandatory fields for every clinical document per CFP 06/2019:
 * identification of the requesting party (solicitante), psychologist info,
 * demand description, procedures, conclusion, location/date, and optional
 * CID-10 codes.
 */
export const baseDocumentContentSchema = z.object({
  solicitante: z.string().min(1, { message: 'Solicitante é obrigatório.' }),
  psychologistInfo: psychologistInfoSchema,
  demanda: z.string().min(1, { message: 'Demanda é obrigatória.' }),
  procedimentos: z.string().min(1, { message: 'Procedimentos é obrigatório.' }),
  conclusao: z.string().min(1, { message: 'Conclusão é obrigatória.' }),
  localData: localDataSchema,
  cid10Codes: z.array(cid10EntrySchema).optional().default([]),
});

// ---------------------------------------------------------------------------
// Per-type content schemas (discriminated by document_type)
// ---------------------------------------------------------------------------

/**
 * Declaração: brief statement, no analise section required.
 * CFP 06/2019 Art. 7: declarações inform about attendance, duration, etc.
 */
export const declaracaoContentSchema = baseDocumentContentSchema.extend({
  document_type: z.literal('declaracao'),
});

/**
 * Atestado: certification with optional period/validity.
 * CFP 06/2019 Art. 8: atestados certify clinical conditions.
 */
export const atestadoContentSchema = baseDocumentContentSchema.extend({
  document_type: z.literal('atestado'),
  period: z.string().optional(),
  validity: z.string().optional(),
});

/**
 * Relatório: requires analise section (detailed analysis).
 * CFP 06/2019 Art. 9: relatórios require description and analysis of procedures.
 */
export const relatorioContentSchema = baseDocumentContentSchema.extend({
  document_type: z.literal('relatorio'),
  analise: z.string().min(1, { message: 'Análise é obrigatória para relatório.' }),
});

/**
 * Laudo: requires analise section (in-depth analysis).
 * CFP 06/2019 Art. 10: laudos require thorough analysis of facts.
 */
export const laudoContentSchema = baseDocumentContentSchema.extend({
  document_type: z.literal('laudo'),
  analise: z.string().min(1, { message: 'Análise é obrigatória para laudo.' }),
});

/**
 * Parecer: requires analise section (expert opinion analysis).
 * CFP 06/2019 Art. 11: pareceres require technical analysis and opinion.
 */
export const parecerContentSchema = baseDocumentContentSchema.extend({
  document_type: z.literal('parecer'),
  analise: z.string().min(1, { message: 'Análise é obrigatória para parecer.' }),
});

// ---------------------------------------------------------------------------
// Discriminated union (dispatches by document_type)
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all document content schemas, keyed by `document_type`.
 * Use this to validate finalized document content where all mandatory fields
 * must be present and type-specific rules apply.
 */
export const documentContentSchema = z.discriminatedUnion('document_type', [
  declaracaoContentSchema,
  atestadoContentSchema,
  relatorioContentSchema,
  laudoContentSchema,
  parecerContentSchema,
]);

export type DocumentContent = z.infer<typeof documentContentSchema>;

// ---------------------------------------------------------------------------
// Input schemas for Server Actions
// ---------------------------------------------------------------------------

/**
 * Input for creating a new clinical document.
 * Content is intentionally loose at creation (partial draft) — full content
 * validation happens at finalization via the discriminated union.
 */
export const createDocumentInputSchema = z.object({
  patientId: z.string().uuid({ message: 'patientId deve ser um UUID válido.' }),
  document_type: documentTypeSchema,
  title: z.string().optional().default(''),
  content: z.object({}).passthrough().optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentInputSchema>;

/**
 * Input for updating a draft clinical document.
 * Content is unstructured at update time — the server validates per type
 * only during finalization.
 */
export const updateDocumentInputSchema = z.object({
  documentId: z.string().uuid({ message: 'documentId deve ser um UUID válido.' }),
  title: z.string().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateDocumentInput = z.infer<typeof updateDocumentInputSchema>;

/**
 * Input for finalizing a clinical document (triggering PDF generation).
 * CID-10 consent must be explicitly confirmed when the document references
 * CID-10 codes (RN-05.06 / LGPD art. 11).
 */
export const finalizeDocumentInputSchema = z.object({
  documentId: z.string().uuid({ message: 'documentId deve ser um UUID válido.' }),
  cid10ConsentConfirmed: z.boolean().optional().default(false),
});

export type FinalizeDocumentInput = z.infer<typeof finalizeDocumentInputSchema>;

// ---------------------------------------------------------------------------
// CID-10 reference computation
// ---------------------------------------------------------------------------

/**
 * Safely determines whether the given content references any CID-10 codes.
 *
 * Used by the finalization flow to decide whether CID-10 consent is required
 * (RN-05.06). Returns false on any type error — defensive against arbitrary
 * JSONB shapes stored during drafts.
 */
export function computeReferencesCid10(content: unknown): boolean {
  if (content === null || content === undefined || typeof content !== 'object') {
    return false;
  }

  const record = content as Record<string, unknown>;
  const codes = record['cid10Codes'];

  if (!Array.isArray(codes)) {
    return false;
  }

  return codes.length > 0;
}
