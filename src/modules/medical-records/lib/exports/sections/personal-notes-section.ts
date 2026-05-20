/**
 * Personal notes section renderer for prontuario export PDFs.
 *
 * Renders a prominent warning header ("ATENCAO — Conteudo restrito ao
 * psicologo") followed by the personal notes content. This section is
 * only included when the psychologist explicitly opts in via double
 * confirmation (filters.includePersonalNotes = true).
 */

import { htmlToText } from '@/modules/medical-records/lib/pdf/html-to-text';

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonalNoteForExport {
  content: string | null;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

const SECTION_TITLE_FONT_SIZE = 14;
const WARNING_FONT_SIZE = 12;
const BODY_FONT_SIZE = 11;
const META_FONT_SIZE = 9;

const WARNING_BG_COLOR = '#FEF2F2';
const WARNING_BORDER_COLOR = '#DC2626';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDatePtBr(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------------------
// Warning banner
// ---------------------------------------------------------------------------

function renderWarningBanner(doc: PdfDoc): void {
  const leftMargin = doc.page.margins?.left ?? 50;
  const contentWidth = doc.page.width - leftMargin - (doc.page.margins?.right ?? 50);
  const bannerHeight = 30;
  const bannerY = doc.y;

  // Background
  doc.rect(leftMargin, bannerY, contentWidth, bannerHeight).fill(WARNING_BG_COLOR);

  // Left border accent
  doc.rect(leftMargin, bannerY, 3, bannerHeight).fill(WARNING_BORDER_COLOR);

  // Warning text
  doc
    .fill('#000000')
    .font(FONT_BOLD)
    .fontSize(WARNING_FONT_SIZE)
    .text('ATENCAO — Conteudo restrito ao psicologo', leftMargin + 12, bannerY + 8, {
      width: contentWidth - 20,
    });

  // Advance cursor past the banner
  doc.y = bannerY + bannerHeight;
  doc.x = leftMargin;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderPersonalNotesSection(doc: PdfDoc, notes: PersonalNoteForExport[]): void {
  doc.font(FONT_BOLD).fontSize(SECTION_TITLE_FONT_SIZE).text('Anotacoes Pessoais');
  doc.moveDown(0.8);

  renderWarningBanner(doc);
  doc.moveDown(0.8);

  if (notes.length === 0) {
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text('Nenhuma anotacao pessoal registrada.');
    doc.moveDown(1);
    return;
  }

  for (const note of notes) {
    if (!note.content?.trim()) continue;

    const plainText = htmlToText(note.content);
    if (!plainText) continue;

    doc
      .font(FONT_REGULAR)
      .fontSize(META_FONT_SIZE)
      .text(`Ultima atualizacao: ${formatDatePtBr(note.updatedAt)}`);
    doc.moveDown(0.3);

    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(plainText, { align: 'justify' });
    doc.moveDown(0.8);
  }
}
