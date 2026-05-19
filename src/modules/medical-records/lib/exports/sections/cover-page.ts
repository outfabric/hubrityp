/**
 * Cover page renderer for prontuario export PDFs.
 *
 * Renders patient identification, psychologist info, export date/time,
 * and a summary of the applied filters (which sections are included,
 * date range, personal notes toggle).
 */

import type { ExportFilters } from '../export-schemas';

// ---------------------------------------------------------------------------
// pdfkit type alias
// ---------------------------------------------------------------------------
type PdfDoc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverPageData {
  patient: {
    fullName: string;
    birthDate: string | null;
    patientType: string;
  };
  psychologist: {
    name: string;
    crp: string;
    email: string;
  };
  exportRequestedAt: Date;
  filters: ExportFilters;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

const TITLE_FONT_SIZE = 18;
const SUBTITLE_FONT_SIZE = 13;
const BODY_FONT_SIZE = 11;
const LABEL_FONT_SIZE = 10;

// ---------------------------------------------------------------------------
// Section label mapping for the filters summary
// ---------------------------------------------------------------------------

const SECTION_LABELS: ReadonlyArray<{ key: keyof ExportFilters['sections']; label: string }> = [
  { key: 'anamnese', label: 'Anamnese' },
  { key: 'evolucoes', label: 'Evolucoes' },
  { key: 'hipoteses', label: 'Hipoteses diagnosticas' },
  { key: 'planoTerapeutico', label: 'Plano terapeutico' },
  { key: 'escalas', label: 'Escalas' },
  { key: 'documentos', label: 'Documentos clinicos' },
  { key: 'anexosIndex', label: 'Indice de anexos' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTimePtBr(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} as ${hours}:${minutes}`;
}

function formatDatePtBr(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------------------
// Cover page renderer
// ---------------------------------------------------------------------------

export function renderCoverPage(doc: PdfDoc, data: CoverPageData): void {
  const { patient, psychologist, exportRequestedAt, filters } = data;
  const leftMargin = doc.page.margins?.left ?? 50;
  const contentWidth = doc.page.width - leftMargin - (doc.page.margins?.right ?? 50);

  // --- Title ---
  doc.moveDown(3);
  doc.font(FONT_BOLD).fontSize(TITLE_FONT_SIZE).text('Prontuario Psicologico', { align: 'center' });
  doc.moveDown(0.5);
  doc
    .font(FONT_REGULAR)
    .fontSize(SUBTITLE_FONT_SIZE)
    .text('Exportacao de Prontuario', { align: 'center' });
  doc.moveDown(2);

  // --- Separator ---
  const separatorY = doc.y;
  doc
    .moveTo(leftMargin, separatorY)
    .lineTo(leftMargin + contentWidth, separatorY)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(1);

  // --- Patient info ---
  doc.font(FONT_BOLD).fontSize(SUBTITLE_FONT_SIZE).text('Dados do Paciente');
  doc.moveDown(0.5);

  renderKeyValue(doc, 'Nome', patient.fullName);
  if (patient.birthDate) {
    renderKeyValue(doc, 'Data de nascimento', formatDatePtBr(patient.birthDate));
  }
  renderKeyValue(doc, 'Tipo', patient.patientType);
  doc.moveDown(1);

  // --- Psychologist info ---
  doc.font(FONT_BOLD).fontSize(SUBTITLE_FONT_SIZE).text('Psicologo(a) Responsavel');
  doc.moveDown(0.5);

  renderKeyValue(doc, 'Nome', psychologist.name);
  renderKeyValue(doc, 'CRP', psychologist.crp);
  renderKeyValue(doc, 'E-mail', psychologist.email);
  doc.moveDown(1);

  // --- Export metadata ---
  doc.font(FONT_BOLD).fontSize(SUBTITLE_FONT_SIZE).text('Informacoes da Exportacao');
  doc.moveDown(0.5);

  renderKeyValue(doc, 'Data/hora da solicitacao', formatDateTimePtBr(exportRequestedAt));

  // Date range filter
  const from = filters.dateRange.from;
  const to = filters.dateRange.to;
  if (from || to) {
    const rangeText = [
      from ? `De ${formatDatePtBr(from)}` : null,
      to ? `Ate ${formatDatePtBr(to)}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    renderKeyValue(doc, 'Periodo', rangeText);
  } else {
    renderKeyValue(doc, 'Periodo', 'Completo (sem filtro de data)');
  }
  doc.moveDown(1);

  // --- Sections included ---
  doc.font(FONT_BOLD).fontSize(SUBTITLE_FONT_SIZE).text('Secoes Incluidas');
  doc.moveDown(0.5);

  doc.font(FONT_REGULAR).fontSize(LABEL_FONT_SIZE);
  for (const { key, label } of SECTION_LABELS) {
    const included = filters.sections[key];
    const marker = included ? '[x]' : '[ ]';
    doc.text(`${marker} ${label}`);
  }

  const notesMarker = filters.includePersonalNotes ? '[x]' : '[ ]';
  doc.text(`${notesMarker} Anotacoes pessoais`);
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/** Renders a "Label: value" pair in the body font. */
function renderKeyValue(doc: PdfDoc, label: string, value: string): void {
  doc
    .font(FONT_BOLD)
    .fontSize(BODY_FONT_SIZE)
    .text(`${label}: `, { continued: true })
    .font(FONT_REGULAR)
    .text(value);
}
