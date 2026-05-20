/**
 * Clinical documents section renderer for prontuario export PDFs.
 *
 * Renders a reference table with columns: type, title, status, date,
 * references_cid10.
 */

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClinicalDocumentRow {
  documentType: string;
  title: string;
  status: string;
  referencesCid10: boolean;
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
// Document type labels in Portuguese
// ---------------------------------------------------------------------------

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  declaracao: 'Declaracao',
  atestado: 'Atestado',
  relatorio: 'Relatorio',
  laudo: 'Laudo',
  parecer: 'Parecer',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  finalized: 'Finalizado',
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

function renderTable(doc: PdfDoc, rows: ClinicalDocumentRow[]): void {
  const leftMargin = doc.page.margins?.left ?? 50;
  const contentWidth = doc.page.width - leftMargin - (doc.page.margins?.right ?? 50);

  const colWidths = {
    type: contentWidth * 0.15,
    title: contentWidth * 0.3,
    status: contentWidth * 0.18,
    date: contentWidth * 0.2,
    cid10: contentWidth * 0.17,
  };

  const startY = doc.y;

  // Header
  doc.font(FONT_BOLD).fontSize(TABLE_HEADER_FONT_SIZE);
  let x = leftMargin;
  doc.text('Tipo', x, startY, { width: colWidths.type });
  x += colWidths.type;
  doc.text('Titulo', x, startY, { width: colWidths.title });
  x += colWidths.title;
  doc.text('Status', x, startY, { width: colWidths.status });
  x += colWidths.status;
  doc.text('Data', x, startY, { width: colWidths.date });
  x += colWidths.date;
  doc.text('CID-10', x, startY, { width: colWidths.cid10 });

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
    const typeLabel = DOCUMENT_TYPE_LABELS[row.documentType] ?? row.documentType;
    const statusLabel = STATUS_LABELS[row.status] ?? row.status;
    const cid10Text = row.referencesCid10 ? 'Sim' : 'Nao';

    doc.text(typeLabel, x, rowY, { width: colWidths.type });
    x += colWidths.type;
    doc.text(row.title || '-', x, rowY, { width: colWidths.title });
    x += colWidths.title;
    doc.text(statusLabel, x, rowY, { width: colWidths.status });
    x += colWidths.status;
    doc.text(formatDatePtBr(row.createdAt), x, rowY, { width: colWidths.date });
    x += colWidths.date;
    doc.text(cid10Text, x, rowY, { width: colWidths.cid10 });

    rowY += ROW_HEIGHT;
  }

  doc.y = rowY;
  doc.x = leftMargin;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderDocumentsSection(doc: PdfDoc, documents: ClinicalDocumentRow[]): void {
  doc.font(FONT_BOLD).fontSize(SECTION_TITLE_FONT_SIZE).text('Documentos Clinicos');
  doc.moveDown(0.8);

  if (documents.length === 0) {
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text('Nenhum documento clinico registrado.');
    doc.moveDown(1);
    return;
  }

  renderTable(doc, documents);
  doc.moveDown(1);
}
