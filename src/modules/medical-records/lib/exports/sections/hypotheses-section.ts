/**
 * Diagnostic hypotheses section renderer for prontuario export PDFs.
 *
 * Renders a table with columns: CID-10 code, description, status, date.
 */

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HypothesisRow {
  cid10Code: string | null;
  description: string | null;
  cid10Description: string | null;
  status: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

const SECTION_TITLE_FONT_SIZE = 14;
const BODY_FONT_SIZE = 11;
const TABLE_FONT_SIZE = 9;
const TABLE_HEADER_FONT_SIZE = 9;

const ROW_HEIGHT = 18;
const HEADER_HEIGHT = 20;

// ---------------------------------------------------------------------------
// Status labels in Portuguese
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  investigating: 'Em investigacao',
  confirmed: 'Confirmada',
  discarded: 'Descartada',
};

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
// Table renderer
// ---------------------------------------------------------------------------

function renderTable(doc: PdfDoc, rows: HypothesisRow[]): void {
  const leftMargin = doc.page.margins?.left ?? 50;
  const contentWidth = doc.page.width - leftMargin - (doc.page.margins?.right ?? 50);

  // Column widths (proportional)
  const colWidths = {
    cid10: contentWidth * 0.15,
    description: contentWidth * 0.4,
    status: contentWidth * 0.22,
    date: contentWidth * 0.23,
  };

  const startY = doc.y;

  // Header
  doc.font(FONT_BOLD).fontSize(TABLE_HEADER_FONT_SIZE);
  let x = leftMargin;
  doc.text('CID-10', x, startY, { width: colWidths.cid10 });
  x += colWidths.cid10;
  doc.text('Descricao', x, startY, { width: colWidths.description });
  x += colWidths.description;
  doc.text('Status', x, startY, { width: colWidths.status });
  x += colWidths.status;
  doc.text('Data', x, startY, { width: colWidths.date });

  // Header underline
  const lineY = startY + HEADER_HEIGHT;
  doc
    .moveTo(leftMargin, lineY)
    .lineTo(leftMargin + contentWidth, lineY)
    .lineWidth(0.5)
    .stroke();

  // Rows
  doc.font(FONT_REGULAR).fontSize(TABLE_FONT_SIZE);
  let rowY = lineY + 4;

  for (const row of rows) {
    x = leftMargin;
    const cid10Text = row.cid10Code ?? '-';
    const descText = row.description ?? row.cid10Description ?? '-';
    const statusText = STATUS_LABELS[row.status] ?? row.status;
    const dateText = formatDatePtBr(row.createdAt);

    doc.text(cid10Text, x, rowY, { width: colWidths.cid10 });
    x += colWidths.cid10;
    doc.text(descText, x, rowY, { width: colWidths.description });
    x += colWidths.description;
    doc.text(statusText, x, rowY, { width: colWidths.status });
    x += colWidths.status;
    doc.text(dateText, x, rowY, { width: colWidths.date });

    rowY += ROW_HEIGHT;
  }

  // Move doc cursor past the table
  doc.y = rowY;
  doc.x = leftMargin;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderHypothesesSection(doc: PdfDoc, hypotheses: HypothesisRow[]): void {
  doc.font(FONT_BOLD).fontSize(SECTION_TITLE_FONT_SIZE).text('Hipoteses Diagnosticas');
  doc.moveDown(0.8);

  if (hypotheses.length === 0) {
    doc
      .font(FONT_REGULAR)
      .fontSize(BODY_FONT_SIZE)
      .text('Nenhuma hipotese diagnostica registrada.');
    doc.moveDown(1);
    return;
  }

  renderTable(doc, hypotheses);
  doc.moveDown(1);
}
