/**
 * Attachments section renderer for prontuario export PDFs.
 *
 * Renders a category summary count (e.g., "Imagens: 5, Documentos: 3")
 * followed by a reference table with columns: display_name, category,
 * size, uploaded_at.
 */

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttachmentRow {
  displayName: string;
  category: string;
  fileSize: number;
  uploadedAt: Date;
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
// Category labels in Portuguese
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  exam: 'Exames',
  image: 'Imagens',
  drawing: 'Desenhos',
  audio: 'Audios',
  other: 'Outros',
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

/** Format file size in human-readable form (KB or MB). */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Category summary
// ---------------------------------------------------------------------------

function renderCategorySummary(doc: PdfDoc, attachments: AttachmentRow[]): void {
  const counts = new Map<string, number>();

  for (const att of attachments) {
    const current = counts.get(att.category) ?? 0;
    counts.set(att.category, current + 1);
  }

  const parts: string[] = [];
  for (const [category, count] of counts) {
    const label = CATEGORY_LABELS[category] ?? category;
    parts.push(`${label}: ${count}`);
  }

  if (parts.length > 0) {
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(parts.join(', '));
    doc.moveDown(0.5);
  }
}

// ---------------------------------------------------------------------------
// Table renderer
// ---------------------------------------------------------------------------

function renderTable(doc: PdfDoc, rows: AttachmentRow[]): void {
  const leftMargin = doc.page.margins?.left ?? 50;
  const contentWidth = doc.page.width - leftMargin - (doc.page.margins?.right ?? 50);

  const colWidths = {
    name: contentWidth * 0.35,
    category: contentWidth * 0.22,
    size: contentWidth * 0.2,
    date: contentWidth * 0.23,
  };

  const startY = doc.y;

  // Header
  doc.font(FONT_BOLD).fontSize(TABLE_HEADER_FONT_SIZE);
  let x = leftMargin;
  doc.text('Nome', x, startY, { width: colWidths.name });
  x += colWidths.name;
  doc.text('Categoria', x, startY, { width: colWidths.category });
  x += colWidths.category;
  doc.text('Tamanho', x, startY, { width: colWidths.size });
  x += colWidths.size;
  doc.text('Data de upload', x, startY, { width: colWidths.date });

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
    const categoryLabel = CATEGORY_LABELS[row.category] ?? row.category;

    doc.text(row.displayName, x, rowY, { width: colWidths.name });
    x += colWidths.name;
    doc.text(categoryLabel, x, rowY, { width: colWidths.category });
    x += colWidths.category;
    doc.text(formatFileSize(row.fileSize), x, rowY, { width: colWidths.size });
    x += colWidths.size;
    doc.text(formatDatePtBr(row.uploadedAt), x, rowY, { width: colWidths.date });

    rowY += ROW_HEIGHT;
  }

  doc.y = rowY;
  doc.x = leftMargin;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderAttachmentsSection(doc: PdfDoc, attachments: AttachmentRow[]): void {
  doc.font(FONT_BOLD).fontSize(SECTION_TITLE_FONT_SIZE).text('Indice de Anexos');
  doc.moveDown(0.8);

  if (attachments.length === 0) {
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text('Nenhum anexo registrado.');
    doc.moveDown(1);
    return;
  }

  renderCategorySummary(doc, attachments);
  renderTable(doc, attachments);
  doc.moveDown(1);
}
