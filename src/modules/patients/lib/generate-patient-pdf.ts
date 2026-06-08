import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import PDFDocument from 'pdfkit';

import type { Anamnesis } from '@/shared/db/schema/patients/tables';

import { formatAddress } from './format-address';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for generating a patient export PDF.
 *
 * All data is passed in — this function is pure (no DB or Supabase deps).
 * The `anamnesis` field is null when the patient has no anamnesis record
 * or when clinical data was explicitly excluded by the psychologist.
 */
export type PatientPdfInput = {
  // --- Psychologist (header) ---
  psychologistName: string;
  /** Formatted as "UF/number", e.g. "SP/123456" */
  psychologistCrp: string;

  // --- Patient cadastral data ---
  fullName: string;
  birthDate: Date | null;
  approximateAge: string | null;
  phone: string | null;
  email: string | null;
  cpf: string | null;
  address: string | null;
  profession: string | null;
  maritalStatus: string | null;
  source: string | null;
  tags: string[];
  notes: string | null;
  status: string;
  createdAt: Date;

  // --- Clinical data (optional) ---
  /** null = clinical data excluded or no anamnesis exists */
  anamnesis: Anamnesis | null;
  /**
   * When true the psychologist chose to include clinical data but no
   * anamnesis record exists — the PDF shows "Sem anamnese registrada".
   */
  includeClinicalData: boolean;
};

// ---------------------------------------------------------------------------
// Label maps (pt-BR display strings for PDF)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  archived: 'Arquivado',
};

const MARITAL_STATUS_LABELS: Record<string, string> = {
  single: 'Solteiro(a)',
  married: 'Casado(a)',
  divorced: 'Divorciado(a)',
  widowed: 'Viúvo(a)',
  civil_union: 'União estável',
  other: 'Outro',
};

const SOURCE_LABELS: Record<string, string> = {
  indication: 'Indicação',
  social_media: 'Redes sociais',
  google: 'Google',
  insurance: 'Convênio',
  return: 'Retorno',
  other: 'Outro',
};

/** Anamnesis section keys → pt-BR labels (same order as the UI). */
const ANAMNESIS_SECTION_LABELS: Record<string, string> = {
  chiefComplaint: 'Queixa Principal',
  historyPresentIllness: 'História da Queixa',
  familyHistory: 'História Familiar',
  educationalProfessional: 'Escolar/Profissional',
  physicalHealth: 'Saúde Física',
  priorTherapy: 'Histórico Psicoterapêutico',
  initialHypothesis: 'Hipóteses Diagnósticas',
  treatmentPlan: 'Plano Terapêutico',
};

/** Ordered anamnesis section keys for consistent PDF output. */
const ANAMNESIS_SECTION_ORDER = [
  'chiefComplaint',
  'historyPresentIllness',
  'familyHistory',
  'educationalProfessional',
  'physicalHealth',
  'priorTherapy',
  'initialHypothesis',
  'treatmentPlan',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Masks a CPF for display: "123.456.789-00" → "***.***.789-00"
 * If already unformatted ("12345678900"), formats and masks.
 */
function maskCpf(cpf: string): string {
  // Strip non-digits
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return cpf; // return as-is if invalid length

  return `***.***.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/**
 * Calculates age in years from birth date to today.
 */
function calculateAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates a PDF document for a patient data export.
 *
 * Pure utility — no database or Supabase dependencies. Receives all data
 * needed to render the PDF and returns a Buffer.
 *
 * Layout:
 *   1. Header with psychologist identification and export date
 *   2. Cadastral data section
 *   3. Optional clinical data section (anamnesis)
 *
 * @returns A Buffer containing the PDF data.
 */
export async function generatePatientPdf(input: PatientPdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Ficha do Paciente — ${input.fullName}`,
        Author: input.psychologistName,
        Subject: 'Exportação de dados do paciente',
      },
    });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Header ---
    doc.fontSize(16).text('Ficha do Paciente', { align: 'center' }).moveDown(0.5);

    doc
      .fontSize(10)
      .text(`Emitido por: ${input.psychologistName} — CRP ${input.psychologistCrp}`, {
        align: 'center',
      })
      .moveDown(0.3);

    const exportDate = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    doc.fontSize(9).text(`Data de emissão: ${exportDate}`, { align: 'center' }).moveDown(1.5);

    // --- Separator line ---
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(1);

    // --- Cadastral data section ---
    doc.fontSize(13).text('Dados Cadastrais', { underline: true }).moveDown(0.8);

    addField(doc, 'Nome completo', input.fullName);

    if (input.birthDate) {
      const formattedDate = format(input.birthDate, 'dd/MM/yyyy', { locale: ptBR });
      const age = calculateAge(input.birthDate);
      addField(doc, 'Data de nascimento', `${formattedDate} (${age} anos)`);
    } else if (input.approximateAge) {
      addField(doc, 'Idade aproximada', input.approximateAge);
    }

    if (input.phone) {
      addField(doc, 'Telefone', input.phone);
    }

    if (input.email) {
      addField(doc, 'E-mail', input.email);
    }

    if (input.cpf) {
      addField(doc, 'CPF', maskCpf(input.cpf));
    }

    const formattedAddress = formatAddress(input.address);
    if (formattedAddress) {
      addField(doc, 'Endereço', formattedAddress);
    }

    if (input.profession) {
      addField(doc, 'Profissão', input.profession);
    }

    if (input.maritalStatus) {
      addField(
        doc,
        'Estado civil',
        MARITAL_STATUS_LABELS[input.maritalStatus] ?? input.maritalStatus,
      );
    }

    if (input.source) {
      addField(doc, 'Origem', SOURCE_LABELS[input.source] ?? input.source);
    }

    if (input.tags.length > 0) {
      addField(doc, 'Tags', input.tags.join(', '));
    }

    if (input.notes) {
      addField(doc, 'Observações', input.notes);
    }

    addField(doc, 'Status', STATUS_LABELS[input.status] ?? input.status);

    const createdAtFormatted = format(input.createdAt, 'dd/MM/yyyy', { locale: ptBR });
    addField(doc, 'Cadastrado em', createdAtFormatted);

    // --- Clinical data section ---
    if (input.includeClinicalData) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(1);

      doc.fontSize(13).text('Dados Clínicos — Anamnese', { underline: true }).moveDown(0.8);

      if (!input.anamnesis) {
        doc.fontSize(10).text('Sem anamnese registrada', { oblique: true }).moveDown(0.5);
      } else {
        renderAnamnesisSections(doc, input.anamnesis);
      }
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Adds a label: value pair to the PDF document.
 */
function addField(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc
    .fontSize(10)
    .font('Helvetica-Bold')
    .text(`${label}: `, { continued: true })
    .font('Helvetica')
    .text(value)
    .moveDown(0.3);
}

/**
 * Renders anamnesis standard sections + custom sections into the PDF.
 */
function renderAnamnesisSections(doc: PDFKit.PDFDocument, anam: Anamnesis): void {
  let hasContent = false;

  // Standard sections (ordered)
  for (const key of ANAMNESIS_SECTION_ORDER) {
    const value = anam[key];
    if (value) {
      hasContent = true;
      const label = ANAMNESIS_SECTION_LABELS[key] ?? key;
      doc.fontSize(11).font('Helvetica-Bold').text(label).moveDown(0.2);
      doc.fontSize(10).font('Helvetica').text(value, { align: 'justify' }).moveDown(0.6);
    }
  }

  // Custom sections (JSONB array)
  const customSections = anam.customSections as
    | Array<{ title: string; content: string }>
    | null
    | undefined;

  if (customSections && Array.isArray(customSections)) {
    for (const section of customSections) {
      if (section.title && section.content) {
        hasContent = true;
        doc.fontSize(11).font('Helvetica-Bold').text(section.title).moveDown(0.2);
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(section.content, { align: 'justify' })
          .moveDown(0.6);
      }
    }
  }

  if (!hasContent) {
    doc.fontSize(10).text('Sem anamnese registrada', { oblique: true }).moveDown(0.5);
  }
}
