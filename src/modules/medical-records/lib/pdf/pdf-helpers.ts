import { htmlToText } from './html-to-text';

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
// `@types/pdfkit` declares PDFDocument as an interface under the `PDFKit`
// namespace and exports it via `export = doc`. Using `import type` from
// 'pdfkit' confuses typescript-eslint's type resolver, so we reference the
// global namespace interface directly.
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Pure PDF helper functions for clinical document generation
// ---------------------------------------------------------------------------
//
// Each function receives a PDFDocument instance and the data it needs. They
// are composable building blocks called by the main orchestrator. None of
// them call `doc.end()` or `doc.addPage()` — the orchestrator controls the
// document lifecycle.
//
// The layout follows CFP 06/2019 (Conselho Federal de Psicologia) guidelines
// for formal clinical documents.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PsychologistInfo {
  name: string;
  crp: string;
  contact?: string;
}

export interface Cid10Entry {
  code: string;
  description: string;
}

export interface LocalData {
  local: string;
  data: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

const HEADER_FONT_SIZE = 14;
const TITLE_FONT_SIZE = 13;
const BODY_FONT_SIZE = 11;
const LABEL_FONT_SIZE = 11;
const FOOTER_FONT_SIZE = 9;
const WATERMARK_FONT_SIZE = 40;

const SECTION_SPACING = 12;

// ---------------------------------------------------------------------------
// Header: psychologist identification
// ---------------------------------------------------------------------------

/**
 * Renders the psychologist header block: name (bold, 14pt), CRP, and optional
 * contact information.
 */
export function buildHeader(doc: PdfDoc, psychologistInfo: PsychologistInfo): void {
  doc.font(FONT_BOLD).fontSize(HEADER_FONT_SIZE).text(psychologistInfo.name, { align: 'center' });

  doc
    .font(FONT_REGULAR)
    .fontSize(BODY_FONT_SIZE)
    .text(`CRP: ${psychologistInfo.crp}`, { align: 'center' });

  if (psychologistInfo.contact) {
    doc.text(psychologistInfo.contact, { align: 'center' });
  }

  doc.moveDown(1.5);
}

// ---------------------------------------------------------------------------
// Title: document type label + custom title
// ---------------------------------------------------------------------------

/** Document-type display labels per CFP 06/2019. */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  declaracao: 'Declaracao Psicologica',
  atestado: 'Atestado Psicologico',
  relatorio: 'Relatorio Psicologico',
  laudo: 'Laudo Psicologico',
  parecer: 'Parecer Psicologico',
};

/**
 * Renders the document title: type label (bold) + custom title (if provided).
 */
export function buildTitle(doc: PdfDoc, documentType: string, title: string): void {
  const label = DOCUMENT_TYPE_LABELS[documentType] ?? documentType;

  doc.font(FONT_BOLD).fontSize(TITLE_FONT_SIZE).text(label, { align: 'center' });

  if (title) {
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(title, { align: 'center' });
  }

  doc.moveDown(1.5);
}

// ---------------------------------------------------------------------------
// Section: label + HTML content
// ---------------------------------------------------------------------------

/**
 * Renders a content section: bold label followed by the body text converted
 * from Tiptap HTML to plain text.
 */
export function buildSection(doc: PdfDoc, label: string, htmlContent: string): void {
  doc.font(FONT_BOLD).fontSize(LABEL_FONT_SIZE).text(label);

  doc.moveDown(0.3);

  const plainText = htmlToText(htmlContent);
  if (plainText) {
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(plainText, { align: 'justify' });
  }

  doc.moveDown(SECTION_SPACING / BODY_FONT_SIZE);
}

// ---------------------------------------------------------------------------
// CID-10 codes section
// ---------------------------------------------------------------------------

/**
 * Renders the CID-10 codes block. Skipped if the array is empty.
 * Format: "CODE - description" per line.
 */
export function buildCid10Section(doc: PdfDoc, codes: Cid10Entry[]): void {
  if (codes.length === 0) return;

  doc.font(FONT_BOLD).fontSize(LABEL_FONT_SIZE).text('Codigos CID-10:');
  doc.moveDown(0.3);

  doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE);
  for (const entry of codes) {
    doc.text(`${entry.code} — ${entry.description}`);
  }

  doc.moveDown(SECTION_SPACING / BODY_FONT_SIZE);
}

// ---------------------------------------------------------------------------
// Local and date
// ---------------------------------------------------------------------------

/**
 * Renders the "Local e Data" line per CFP 06/2019.
 */
export function buildLocalData(doc: PdfDoc, localData: LocalData): void {
  doc
    .font(FONT_REGULAR)
    .fontSize(BODY_FONT_SIZE)
    .text(`Local e Data: ${localData.local}, ${localData.data}`, { align: 'left' });

  doc.moveDown(1.5);
}

// ---------------------------------------------------------------------------
// Signature block
// ---------------------------------------------------------------------------

/**
 * Renders the signature block: horizontal rule, "Assinatura" label, CRP, and
 * a note about acceptable signature types (ICP-Brasil or manual + stamp).
 */
export function buildSignatureBlock(doc: PdfDoc, crp: string): void {
  doc.moveDown(1);

  // Horizontal separator line
  const lineY = doc.y;
  const leftMargin = doc.page.margins?.left ?? 50;
  const rightBound = doc.page.width - (doc.page.margins?.right ?? 50);
  doc.moveTo(leftMargin, lineY).lineTo(rightBound, lineY).lineWidth(0.5).stroke();

  doc.moveDown(0.5);

  doc.font(FONT_BOLD).fontSize(BODY_FONT_SIZE).text('Assinatura', { align: 'center' });

  doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(crp, { align: 'center' });

  doc
    .fontSize(FOOTER_FONT_SIZE)
    .text('ICP-Brasil ou manuscrita + carimbo CRP', { align: 'center' });
}

// ---------------------------------------------------------------------------
// Page numbering
// ---------------------------------------------------------------------------

/**
 * Adds "Pagina X de Y" centered at the bottom of the current page.
 *
 * Must be called after switching to the target page via `doc.switchToPage(i)`.
 */
export function addPageNumber(doc: PdfDoc, current: number, total: number): void {
  const pageHeight = doc.page.height;
  const yPosition = pageHeight - 30;

  doc
    .font(FONT_REGULAR)
    .fontSize(FOOTER_FONT_SIZE)
    .text(`Pagina ${current} de ${total}`, 0, yPosition, {
      align: 'center',
      width: doc.page.width,
    });
}

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

/**
 * Adds a diagonal "DOCUMENTO PSICOLOGICO" watermark across the center of
 * the current page. Uses low opacity (0.11) and ~45-degree rotation.
 *
 * Must be called after switching to the target page via `doc.switchToPage(i)`.
 */
export function addWatermark(doc: PdfDoc): void {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  doc.save();
  doc.opacity(0.11);
  doc.font(FONT_BOLD).fontSize(WATERMARK_FONT_SIZE);

  // Position at page center, then rotate
  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;

  doc.translate(centerX, centerY);
  doc.rotate(-45, { origin: [0, 0] });
  doc.text('DOCUMENTO PSICOLOGICO', -200, -20, { align: 'center', width: 400 });

  doc.restore();
}

// ---------------------------------------------------------------------------
// Buffer collection
// ---------------------------------------------------------------------------

/**
 * Collects the PDF stream into a single Buffer.
 *
 * Must be called BEFORE `doc.end()` — this sets up the event listeners that
 * capture chunks. The returned promise resolves after `doc.end()` triggers
 * the 'end' event.
 */
export function collectBuffer(doc: PdfDoc): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
