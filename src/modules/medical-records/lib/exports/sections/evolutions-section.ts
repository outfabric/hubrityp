/**
 * Evolutions section renderer for prontuario export PDFs.
 *
 * Renders evolutions chronologically grouped by month (e.g., "Janeiro 2026").
 * Each evolution renders its template-aware content fields and any addendum
 * blocks. When the date range excludes all evolutions, the section header
 * is still rendered with an explanatory message.
 */

import { htmlToText } from '@/modules/medical-records/lib/pdf/html-to-text';

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvolutionAddendum {
  versionNumber: number;
  content: Record<string, unknown>;
  reason: string | null;
  createdAt: Date;
}

export interface EvolutionForExport {
  id: string;
  templateType: string;
  content: Record<string, unknown>;
  createdAt: Date;
  finalizedAt: Date | null;
  addenda: EvolutionAddendum[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_ITALIC = 'Helvetica-Oblique';

const SECTION_TITLE_FONT_SIZE = 14;
const MONTH_HEADING_FONT_SIZE = 12;
const FIELD_LABEL_FONT_SIZE = 11;
const BODY_FONT_SIZE = 11;
const META_FONT_SIZE = 9;

// ---------------------------------------------------------------------------
// Month names in Portuguese
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Marco',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

// ---------------------------------------------------------------------------
// Template field labels (Portuguese)
// ---------------------------------------------------------------------------

/** Known content field labels for each evolution template type. */
const TEMPLATE_FIELDS: Record<string, ReadonlyArray<{ key: string; label: string }>> = {
  livre: [{ key: 'content', label: 'Conteúdo' }],
  tcc: [
    { key: 'situation', label: 'Situação' },
    { key: 'automaticThought', label: 'Pensamento automático' },
    { key: 'emotion', label: 'Emoção' },
    { key: 'behavior', label: 'Comportamento' },
    { key: 'intervention', label: 'Intervenção' },
    { key: 'homework', label: 'Tarefa de casa' },
    { key: 'notes', label: 'Observações' },
  ],
  psicanalise: [
    { key: 'manifest', label: 'Conteúdo manifesto' },
    { key: 'latent', label: 'Conteúdo latente' },
    { key: 'transference', label: 'Transferência' },
    { key: 'interpretation', label: 'Interpretação' },
    { key: 'notes', label: 'Observações' },
  ],
};

/** Fallback for unknown template types: render all string values. */
const FALLBACK_LABEL = 'Campo';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDatePtBr(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTimePtBr(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/** Group evolutions by "Month Year" key preserving chronological order. */
function groupByMonth(
  evolutions: EvolutionForExport[],
): Array<{ monthLabel: string; items: EvolutionForExport[] }> {
  const groups = new Map<string, EvolutionForExport[]>();
  const orderedKeys: string[] = [];

  for (const evo of evolutions) {
    const monthIndex = evo.createdAt.getMonth();
    const monthName = MONTH_NAMES[monthIndex] ?? 'Desconhecido';
    const year = evo.createdAt.getFullYear();
    const key = `${monthName} ${year}`;

    const existing = groups.get(key);
    if (existing) {
      existing.push(evo);
    } else {
      groups.set(key, [evo]);
      orderedKeys.push(key);
    }
  }

  return orderedKeys.map((key) => ({
    monthLabel: key,
    items: groups.get(key) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Content field rendering
// ---------------------------------------------------------------------------

function renderEvolutionContent(doc: PdfDoc, evolution: EvolutionForExport): void {
  const content = evolution.content;
  const fields = TEMPLATE_FIELDS[evolution.templateType];

  if (fields) {
    // Template-aware rendering
    for (const { key, label } of fields) {
      const value = content[key];
      if (typeof value !== 'string' || !value.trim()) continue;

      const plainText = htmlToText(value);
      if (!plainText) continue;

      doc.font(FONT_BOLD).fontSize(FIELD_LABEL_FONT_SIZE).text(label);
      doc.moveDown(0.2);
      doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(plainText, { align: 'justify' });
      doc.moveDown(0.5);
    }
  } else {
    // Fallback: render all string fields
    for (const [key, value] of Object.entries(content)) {
      if (typeof value !== 'string' || !value.trim()) continue;

      const plainText = htmlToText(value);
      if (!plainText) continue;

      doc.font(FONT_BOLD).fontSize(FIELD_LABEL_FONT_SIZE).text(`${FALLBACK_LABEL} (${key})`);
      doc.moveDown(0.2);
      doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(plainText, { align: 'justify' });
      doc.moveDown(0.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Addendum rendering
// ---------------------------------------------------------------------------

function renderAddenda(doc: PdfDoc, addenda: EvolutionAddendum[]): void {
  if (addenda.length === 0) return;

  doc.moveDown(0.3);
  doc.font(FONT_BOLD).fontSize(FIELD_LABEL_FONT_SIZE).text('Adendos:');
  doc.moveDown(0.3);

  for (const addendum of addenda) {
    doc
      .font(FONT_ITALIC)
      .fontSize(META_FONT_SIZE)
      .text(`Versão ${addendum.versionNumber} — ${formatDateTimePtBr(addendum.createdAt)}`);

    if (addendum.reason) {
      doc.font(FONT_ITALIC).fontSize(META_FONT_SIZE).text(`Motivo: ${addendum.reason}`);
    }

    doc.moveDown(0.2);

    // Render addendum content fields
    for (const [, value] of Object.entries(addendum.content)) {
      if (typeof value !== 'string' || !value.trim()) continue;

      const plainText = htmlToText(value);
      if (!plainText) continue;

      doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(plainText, { align: 'justify' });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.3);
  }
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderEvolutionsSection(doc: PdfDoc, evolutions: EvolutionForExport[]): void {
  // Section title (always rendered, even when empty)
  doc.font(FONT_BOLD).fontSize(SECTION_TITLE_FONT_SIZE).text('Evoluções');
  doc.moveDown(0.8);

  if (evolutions.length === 0) {
    doc
      .font(FONT_REGULAR)
      .fontSize(BODY_FONT_SIZE)
      .text('Nenhuma evolução no período selecionado.');
    doc.moveDown(1);
    return;
  }

  const monthGroups = groupByMonth(evolutions);

  for (const { monthLabel, items } of monthGroups) {
    // Month heading
    doc.font(FONT_BOLD).fontSize(MONTH_HEADING_FONT_SIZE).text(monthLabel);
    doc.moveDown(0.5);

    for (const evolution of items) {
      // Evolution date header
      const status = evolution.finalizedAt ? 'Finalizada' : 'Rascunho';
      doc
        .font(FONT_BOLD)
        .fontSize(BODY_FONT_SIZE)
        .text(`${formatDatePtBr(evolution.createdAt)} — ${evolution.templateType} (${status})`);
      doc.moveDown(0.3);

      renderEvolutionContent(doc, evolution);
      renderAddenda(doc, evolution.addenda);
      doc.moveDown(0.8);
    }
  }
}
