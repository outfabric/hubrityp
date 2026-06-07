/**
 * Treatment plan section renderer for prontuario export PDFs.
 *
 * Renders the current treatment plan with goals list, phases, resources,
 * success criteria, and a footer with the version count.
 */

import { htmlToText } from '@/modules/medical-records/lib/pdf/html-to-text';

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TreatmentPlanForExport {
  goals: unknown[];
  phases: unknown[];
  resources: string | null;
  successCriteria: string | null;
  currentVersion: number;
}

export interface TreatmentPlanData {
  current: TreatmentPlanForExport | null;
  versionCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_ITALIC = 'Helvetica-Oblique';

const SECTION_TITLE_FONT_SIZE = 14;
const HEADING_FONT_SIZE = 11;
const BODY_FONT_SIZE = 11;
const FOOTER_FONT_SIZE = 9;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely extract the text content of a goal/phase JSONB item. */
function extractItemText(item: unknown): string | null {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    // Goals/phases may have { title, description } or { text } shape
    const text = obj['title'] ?? obj['text'] ?? obj['description'] ?? obj['name'];
    if (typeof text === 'string') return text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function renderListSection(doc: PdfDoc, heading: string, items: unknown[]): void {
  if (items.length === 0) return;

  doc.font(FONT_BOLD).fontSize(HEADING_FONT_SIZE).text(heading);
  doc.moveDown(0.3);

  doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE);
  for (let i = 0; i < items.length; i++) {
    const text = extractItemText(items[i]);
    if (text) {
      doc.text(`${i + 1}. ${text}`);
    }
  }
  doc.moveDown(0.5);
}

function renderRichTextSection(doc: PdfDoc, heading: string, htmlContent: string | null): void {
  if (!htmlContent?.trim()) return;

  const plainText = htmlToText(htmlContent);
  if (!plainText) return;

  doc.font(FONT_BOLD).fontSize(HEADING_FONT_SIZE).text(heading);
  doc.moveDown(0.3);
  doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(plainText, { align: 'justify' });
  doc.moveDown(0.5);
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderTreatmentPlanSection(doc: PdfDoc, data: TreatmentPlanData): void {
  doc.font(FONT_BOLD).fontSize(SECTION_TITLE_FONT_SIZE).text('Plano Terapêutico');
  doc.moveDown(0.8);

  if (!data.current) {
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text('Nenhum plano terapêutico registrado.');
    doc.moveDown(1);
    return;
  }

  const plan = data.current;

  renderListSection(doc, 'Objetivos', plan.goals);
  renderListSection(doc, 'Fases', plan.phases);
  renderRichTextSection(doc, 'Recursos', plan.resources);
  renderRichTextSection(doc, 'Critérios de sucesso', plan.successCriteria);

  // Version footer
  doc
    .font(FONT_ITALIC)
    .fontSize(FOOTER_FONT_SIZE)
    .text(`Versão atual: ${plan.currentVersion} — Total de revisões: ${data.versionCount}`);
  doc.moveDown(1);
}
