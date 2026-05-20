/**
 * Page footer renderer for prontuario export PDFs.
 *
 * Writes "Pagina X de Y - Documento sigiloso — Salvia - Gerado em {timestamp}"
 * at the bottom of every page. Must be called after all content is laid out,
 * using `doc.bufferedPageRange()` + `doc.switchToPage(i)` to revisit pages.
 */

// ---------------------------------------------------------------------------
// pdfkit type alias (same pattern as pdf-helpers.ts)
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FOOTER_FONT_SIZE = 8;
const FOOTER_Y_OFFSET = 30;

// ---------------------------------------------------------------------------
// Footer renderer
// ---------------------------------------------------------------------------

/**
 * Renders the page footer on the current page.
 *
 * Must be called after `doc.switchToPage(i)` for each buffered page. The
 * caller is responsible for iterating the buffered page range.
 *
 * @param doc           PDFKit document (already switched to the target page).
 * @param currentPage   1-based page number.
 * @param totalPages    Total number of pages in the document.
 * @param generatedAt   Timestamp when the export was generated (pt-BR formatted).
 */
export function renderFooter(
  doc: PdfDoc,
  currentPage: number,
  totalPages: number,
  generatedAt: string,
): void {
  const pageHeight = doc.page.height;
  const yPosition = pageHeight - FOOTER_Y_OFFSET;

  doc
    .font(FONT_REGULAR)
    .fontSize(FOOTER_FONT_SIZE)
    .text(
      `Pagina ${currentPage} de ${totalPages} - Documento sigiloso — Salvia - Gerado em ${generatedAt}`,
      0,
      yPosition,
      {
        align: 'center',
        width: doc.page.width,
      },
    );
}
