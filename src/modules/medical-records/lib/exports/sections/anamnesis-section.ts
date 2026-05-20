/**
 * Anamnesis section renderer for prontuario export PDFs.
 *
 * Renders all standard anamnesis sections as heading + body text pairs,
 * followed by any custom sections the psychologist has added.
 */

import { htmlToText } from '@/modules/medical-records/lib/pdf/html-to-text';

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnamnesisData {
  chiefComplaint: string | null;
  historyPresentIllness: string | null;
  familyHistory: string | null;
  educationalProfessional: string | null;
  physicalHealth: string | null;
  priorTherapy: string | null;
  initialHypothesis: string | null;
  treatmentPlan: string | null;
  customSections: Record<string, string>[] | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

const SECTION_TITLE_FONT_SIZE = 14;
const HEADING_FONT_SIZE = 11;
const BODY_FONT_SIZE = 11;

// ---------------------------------------------------------------------------
// Ordered standard sections with Portuguese labels
// ---------------------------------------------------------------------------

const STANDARD_SECTIONS: ReadonlyArray<{
  key: keyof Omit<AnamnesisData, 'customSections'>;
  label: string;
}> = [
  { key: 'chiefComplaint', label: 'Queixa principal' },
  { key: 'historyPresentIllness', label: 'Historia da doenca atual' },
  { key: 'familyHistory', label: 'Historia familiar' },
  { key: 'educationalProfessional', label: 'Historia educacional e profissional' },
  { key: 'physicalHealth', label: 'Saude fisica' },
  { key: 'priorTherapy', label: 'Terapias anteriores' },
  { key: 'initialHypothesis', label: 'Hipotese inicial' },
  { key: 'treatmentPlan', label: 'Plano de tratamento' },
];

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderAnamnesisSection(doc: PdfDoc, data: AnamnesisData): void {
  // Section title
  doc.font(FONT_BOLD).fontSize(SECTION_TITLE_FONT_SIZE).text('Anamnese');
  doc.moveDown(0.8);

  let hasContent = false;

  // Standard sections
  for (const { key, label } of STANDARD_SECTIONS) {
    const rawValue = data[key];
    if (typeof rawValue !== 'string' || !rawValue.trim()) continue;

    hasContent = true;
    const plainText = htmlToText(rawValue);
    if (!plainText) continue;

    doc.font(FONT_BOLD).fontSize(HEADING_FONT_SIZE).text(label);
    doc.moveDown(0.3);
    doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(plainText, { align: 'justify' });
    doc.moveDown(0.8);
  }

  // Custom sections (JSONB array of { title, content } objects)
  if (Array.isArray(data.customSections)) {
    for (const section of data.customSections) {
      if (typeof section !== 'object' || section === null) continue;
      const title = (section as Record<string, unknown>)['title'];
      const content = (section as Record<string, unknown>)['content'];
      if (typeof title !== 'string' || typeof content !== 'string') continue;
      if (!content.trim()) continue;

      hasContent = true;
      const plainText = htmlToText(content);
      if (!plainText) continue;

      doc.font(FONT_BOLD).fontSize(HEADING_FONT_SIZE).text(title);
      doc.moveDown(0.3);
      doc.font(FONT_REGULAR).fontSize(BODY_FONT_SIZE).text(plainText, { align: 'justify' });
      doc.moveDown(0.8);
    }
  }

  if (!hasContent) {
    doc
      .font(FONT_REGULAR)
      .fontSize(BODY_FONT_SIZE)
      .text('Nenhuma informacao de anamnese registrada.', { align: 'left' });
    doc.moveDown(0.8);
  }
}
