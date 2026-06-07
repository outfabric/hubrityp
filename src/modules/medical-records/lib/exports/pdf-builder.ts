/**
 * Orchestrator for prontuario export PDF generation.
 *
 * Creates a PDFKit document with buffered pages, calls each section builder
 * in the prescribed order (respecting filter toggles), writes page footers
 * retroactively via `bufferedPageRange()`, and returns the resulting Buffer.
 *
 * This function is pure: no DB access, no auth, no side effects beyond buffer
 * allocation. All data is received via the input parameter.
 */

import PDFDocument from 'pdfkit';

import type { ExportFilters } from './export-schemas';
import { renderAnamnesisSection, type AnamnesisData } from './sections/anamnesis-section';
import { renderAttachmentsSection, type AttachmentRow } from './sections/attachments-section';
import { renderCoverPage, type CoverPageData } from './sections/cover-page';
import { renderDocumentsSection, type ClinicalDocumentRow } from './sections/documents-section';
import { renderEvolutionsSection, type EvolutionForExport } from './sections/evolutions-section';
import { renderFooter } from './sections/footer';
import { renderHypothesesSection, type HypothesisRow } from './sections/hypotheses-section';
import {
  renderPersonalNotesSection,
  type PersonalNoteForExport,
} from './sections/personal-notes-section';
import { renderScalesSection, type ScaleGroup } from './sections/scales-section';
import {
  renderTreatmentPlanSection,
  type TreatmentPlanForExport,
} from './sections/treatment-plan-section';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatientForExport {
  fullName: string;
  birthDate: string | null;
  patientType: string;
}

export interface PsychologistForExport {
  name: string;
  crp: string;
  email: string;
}

export interface BuildProntuarioPdfInput {
  patient: PatientForExport;
  psychologist: PsychologistForExport;
  exportRequestedAt: Date;
  filters: ExportFilters;
  anamnesis: AnamnesisData | null;
  evolutions: EvolutionForExport[];
  hypotheses: HypothesisRow[];
  treatmentPlan: { current: TreatmentPlanForExport | null; versionCount: number };
  scales: ScaleGroup[];
  documents: ClinicalDocumentRow[];
  attachments: AttachmentRow[];
  personalNotes: PersonalNoteForExport[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as "DD/MM/YYYY HH:mm" for the footer timestamp. */
function formatDateTimePtBr(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Collects the PDF stream into a single Buffer.
 *
 * Must be called BEFORE `doc.end()` — this sets up the event listeners
 * that capture chunks.
 */
function collectBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Builds a complete prontuario export PDF from structured input.
 *
 * Returns a Buffer containing the PDF data. The caller (Inngest job) is
 * responsible for uploading to Supabase Storage.
 *
 * Section order (per spec):
 * 1. Cover page (always)
 * 2. Anamnesis (if filters.sections.anamnese)
 * 3. Evolutions (if filters.sections.evolucoes)
 * 4. Hypotheses (if filters.sections.hipoteses)
 * 5. Treatment plan (if filters.sections.planoTerapeutico)
 * 6. Scales (if filters.sections.escalas)
 * 7. Clinical documents (if filters.sections.documentos)
 * 8. Attachments index (if filters.sections.anexosIndex)
 * 9. Personal notes (only if filters.includePersonalNotes AND data provided)
 *
 * Footers are written retroactively via buffered pages after all content.
 */
export async function buildProntuarioPdf(input: BuildProntuarioPdfInput): Promise<Buffer> {
  const {
    patient,
    psychologist,
    exportRequestedAt,
    filters,
    anamnesis,
    evolutions,
    hypotheses,
    treatmentPlan,
    scales,
    documents,
    attachments,
    personalNotes,
  } = input;

  const doc = new PDFDocument({
    bufferPages: true,
    size: 'A4',
    margin: 50,
    info: {
      Title: `Prontuário - ${patient.fullName}`,
      Author: psychologist.name,
      Subject: 'Exportação de Prontuário Psicológico',
    },
  });

  // Set up buffer collection before any content
  const bufferPromise = collectBuffer(doc);

  // --- 1. Cover page (always) ---
  const coverData: CoverPageData = {
    patient,
    psychologist,
    exportRequestedAt,
    filters,
  };
  renderCoverPage(doc, coverData);

  // --- 2. Anamnesis ---
  if (filters.sections.anamnese && anamnesis) {
    doc.addPage();
    renderAnamnesisSection(doc, anamnesis);
  }

  // --- 3. Evolutions ---
  if (filters.sections.evolucoes) {
    doc.addPage();
    renderEvolutionsSection(doc, evolutions);
  }

  // --- 4. Hypotheses ---
  if (filters.sections.hipoteses) {
    doc.addPage();
    renderHypothesesSection(doc, hypotheses);
  }

  // --- 5. Treatment plan ---
  if (filters.sections.planoTerapeutico) {
    doc.addPage();
    renderTreatmentPlanSection(doc, treatmentPlan);
  }

  // --- 6. Scales ---
  if (filters.sections.escalas) {
    doc.addPage();
    renderScalesSection(doc, scales);
  }

  // --- 7. Clinical documents ---
  if (filters.sections.documentos) {
    doc.addPage();
    renderDocumentsSection(doc, documents);
  }

  // --- 8. Attachments index ---
  if (filters.sections.anexosIndex) {
    doc.addPage();
    renderAttachmentsSection(doc, attachments);
  }

  // --- 9. Personal notes (last, only if explicitly included) ---
  if (personalNotes !== null) {
    doc.addPage();
    renderPersonalNotesSection(doc, personalNotes);
  }

  // --- Retroactive footer on every page ---
  const generatedAt = formatDateTimePtBr(exportRequestedAt);
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    renderFooter(doc, i - range.start + 1, totalPages, generatedAt);
  }

  // Finalize the PDF stream
  doc.end();

  return bufferPromise;
}
