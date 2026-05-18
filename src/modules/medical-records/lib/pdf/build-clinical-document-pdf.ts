import PDFDocument from 'pdfkit';

import type { DocumentType } from '../schemas/clinical-documents';

import {
  addPageNumber,
  addWatermark,
  buildCid10Section,
  buildHeader,
  buildLocalData,
  buildSection,
  buildSignatureBlock,
  buildTitle,
  collectBuffer,
  type Cid10Entry,
  type LocalData,
  type PsychologistInfo,
} from './pdf-helpers';

// ---------------------------------------------------------------------------
// Main orchestrator for clinical document PDF generation
// ---------------------------------------------------------------------------
//
// Composes the pure helper functions into a complete CFP 06/2019 compliant
// PDF document. Uses pdfkit with `bufferPages: true` so that page numbering
// and watermarks can be applied after all content is laid out.
//
// This function is pure: no DB, no auth, no side effects beyond buffer
// allocation. It receives all data needed to render the document.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildPdfInput {
  documentType: DocumentType;
  title: string;
  content: Record<string, unknown>;
  psychologistInfo: PsychologistInfo;
}

// ---------------------------------------------------------------------------
// Section rendering order and labels (Portuguese, per CFP 06/2019)
// ---------------------------------------------------------------------------

/** Ordered list of content keys to render as sections, with their labels. */
const SECTION_ORDER: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'solicitante', label: 'Solicitante' },
  { key: 'demanda', label: 'Demanda' },
  { key: 'procedimentos', label: 'Procedimentos' },
  { key: 'analise', label: 'Analise' },
  { key: 'conclusao', label: 'Conclusao' },
  { key: 'period', label: 'Periodo' },
  { key: 'validity', label: 'Validade' },
];

// ---------------------------------------------------------------------------
// Document type labels (Portuguese display names)
// ---------------------------------------------------------------------------

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  declaracao: 'Declaracao Psicologica',
  atestado: 'Atestado Psicologico',
  relatorio: 'Relatorio Psicologico',
  laudo: 'Laudo Psicologico',
  parecer: 'Parecer Psicologico',
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Builds a complete clinical document PDF from structured input.
 *
 * Returns a Buffer containing the PDF data. The caller is responsible for
 * persisting or streaming the buffer (e.g., uploading to Supabase Storage).
 *
 * Layout sequence:
 * 1. Header (psychologist identification)
 * 2. Title (document type label + optional custom title)
 * 3. Content sections (in CFP 06/2019 order)
 * 4. CID-10 codes (if present)
 * 5. Local and date
 * 6. Signature block
 * 7. Page numbering + watermark (applied retroactively via buffered pages)
 */
export async function buildClinicalDocumentPdf(input: BuildPdfInput): Promise<Buffer> {
  const { documentType, title, content, psychologistInfo } = input;

  const doc = new PDFDocument({
    bufferPages: true,
    size: 'A4',
    margin: 50,
    info: {
      Title: DOCUMENT_TYPE_LABELS[documentType],
      Author: psychologistInfo.name,
      Subject: `${DOCUMENT_TYPE_LABELS[documentType]} - ${title || 'Sem titulo'}`,
    },
  });

  // Set up buffer collection before writing any content
  const bufferPromise = collectBuffer(doc);

  // --- 1. Header ---
  buildHeader(doc, psychologistInfo);

  // --- 2. Title ---
  buildTitle(doc, documentType, title);

  // --- 3. Content sections ---
  for (const { key, label } of SECTION_ORDER) {
    const value = content[key];
    if (typeof value === 'string' && value.trim()) {
      buildSection(doc, label, value);
    }
  }

  // --- 4. CID-10 codes ---
  const cid10Codes = extractCid10Codes(content);
  buildCid10Section(doc, cid10Codes);

  // --- 5. Local and date ---
  const localData = extractLocalData(content);
  if (localData) {
    buildLocalData(doc, localData);
  }

  // --- 6. Signature block ---
  buildSignatureBlock(doc, psychologistInfo.crp);

  // --- 7. Page numbering + watermark (retroactive via buffered pages) ---
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    addPageNumber(doc, i - range.start + 1, totalPages);
    addWatermark(doc);
  }

  // Finalize the PDF stream
  doc.end();

  return bufferPromise;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts CID-10 entries from the content JSONB. Returns an empty array if
 * the field is missing or malformed (defensive against draft content).
 */
function extractCid10Codes(content: Record<string, unknown>): Cid10Entry[] {
  const raw = content['cid10Codes'];
  if (!Array.isArray(raw)) return [];

  return raw.filter(
    (entry): entry is Cid10Entry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)['code'] === 'string' &&
      typeof (entry as Record<string, unknown>)['description'] === 'string',
  );
}

/**
 * Extracts local/date data from the content JSONB. Returns null if the field
 * is missing or malformed.
 */
function extractLocalData(content: Record<string, unknown>): LocalData | null {
  const raw = content['localData'];
  if (typeof raw !== 'object' || raw === null) return null;

  const record = raw as Record<string, unknown>;
  const local = record['local'];
  const data = record['data'];

  if (typeof local !== 'string' || typeof data !== 'string') return null;
  if (!local.trim() || !data.trim()) return null;

  return { local, data };
}
