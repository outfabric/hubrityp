import { describe, expect, it } from 'vitest';

import {
  generatePatientPdf,
  type PatientPdfInput,
} from '@/modules/patients/lib/generate-patient-pdf';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<PatientPdfInput> = {}): PatientPdfInput {
  return {
    psychologistName: 'Dra. Maria Silva',
    psychologistCrp: 'SP/123456',
    fullName: 'João Souza',
    birthDate: new Date('1990-05-15T00:00:00-03:00'),
    approximateAge: null,
    phone: '(11) 99999-8888',
    email: 'joao@example.com',
    cpf: '123.456.789-00',
    address: 'Rua das Flores, 123 — São Paulo, SP',
    profession: 'Engenheiro',
    maritalStatus: 'married',
    source: 'indication',
    tags: ['ansiedade', 'adulto'],
    notes: 'Paciente pontual.',
    status: 'active',
    createdAt: new Date('2025-01-10T10:00:00-03:00'),
    anamnesis: null,
    includeClinicalData: false,
    ...overrides,
  };
}

function makeAnamnesis(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    patientId: '00000000-0000-0000-0000-000000000002',
    chiefComplaint: 'Ansiedade generalizada',
    historyPresentIllness: 'Paciente relata sintomas há 6 meses.',
    familyHistory: 'Mãe com histórico de depressão.',
    educationalProfessional: 'Formado em engenharia, trabalha em startup.',
    physicalHealth: 'Sem comorbidades.',
    priorTherapy: 'Fez terapia por 2 anos na adolescência.',
    initialHypothesis: 'TAG — Transtorno de Ansiedade Generalizada.',
    treatmentPlan: 'TCC semanal com foco em reestruturação cognitiva.',
    customSections: null,
    createdAt: new Date('2025-02-01T10:00:00-03:00'),
    updatedAt: new Date('2025-02-15T10:00:00-03:00'),
    ...overrides,
  };
}

/**
 * Decode the raw PDF buffer as latin1 for searching uncompressed sections.
 *
 * PDFKit compresses the content stream with FlateDecode, so body text is
 * not directly readable. However, the PDF info dictionary (metadata) and
 * structural markers are stored uncompressed — those are what we assert on.
 */
function pdfToString(buf: Buffer): string {
  return buf.toString('latin1');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generatePatientPdf', () => {
  // -- Structural validation -----------------------------------------------

  it('returns a Buffer', async () => {
    const result = await generatePatientPdf(makeInput());

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('returns a non-empty Buffer', async () => {
    const result = await generatePatientPdf(makeInput());

    expect(result.length).toBeGreaterThan(0);
  });

  it('starts with %PDF magic bytes (valid PDF header)', async () => {
    const result = await generatePatientPdf(makeInput());
    const header = result.subarray(0, 5).toString('ascii');

    expect(header).toBe('%PDF-');
  });

  it('ends with %%EOF marker', async () => {
    const result = await generatePatientPdf(makeInput());
    const trailer = result.subarray(-6).toString('ascii').trim();

    expect(trailer).toBe('%%EOF');
  });

  // -- Metadata (stored uncompressed in the info dict) ---------------------

  it('sets the PDF title containing the patient name', async () => {
    const buf = await generatePatientPdf(makeInput({ fullName: 'Carlos Mendes' }));

    // PDFKit encodes info strings containing non-ASCII as UTF-16BE with BOM.
    // Search for the Subject fragment in the raw buffer.
    const subjectUtf16 = Buffer.from('de dados do paciente', 'utf16le').swap16();
    expect(buf.includes(subjectUtf16)).toBe(true);

    // The patient name appears in the UTF-16BE title. To verify, search
    // the raw buffer for the UTF-16BE encoded name bytes.
    const nameUtf16 = Buffer.from('Carlos Mendes', 'utf16le').swap16();
    expect(buf.includes(nameUtf16)).toBe(true);
  });

  it('sets the Author metadata to the psychologist name', async () => {
    const text = pdfToString(
      await generatePatientPdf(makeInput({ psychologistName: 'Dr. Roberto Santos' })),
    );

    expect(text).toContain('Dr. Roberto Santos');
  });

  // -- Page structure ------------------------------------------------------

  it('uses A4 page size', async () => {
    const text = pdfToString(await generatePatientPdf(makeInput()));

    // A4 dimensions in points: 595.28 x 841.89
    expect(text).toContain('595.28');
    expect(text).toContain('841.89');
  });

  it('uses Helvetica font', async () => {
    const text = pdfToString(await generatePatientPdf(makeInput()));

    expect(text).toContain('/BaseFont /Helvetica');
  });

  // -- Content differentiation (body is compressed, but unique per input) --

  it('produces different output for different patient names', async () => {
    const pdf1 = await generatePatientPdf(makeInput({ fullName: 'Alice' }));
    const pdf2 = await generatePatientPdf(makeInput({ fullName: 'Bob' }));

    expect(pdf1.equals(pdf2)).toBe(false);
  });

  it('produces different output for different psychologist CRPs', async () => {
    const pdf1 = await generatePatientPdf(makeInput({ psychologistCrp: 'SP/111111' }));
    const pdf2 = await generatePatientPdf(makeInput({ psychologistCrp: 'RJ/999999' }));

    expect(pdf1.equals(pdf2)).toBe(false);
  });

  // -- Cadastral data only (no clinical data) ------------------------------

  it('generates PDF without clinical section when includeClinicalData is false', async () => {
    const pdf = await generatePatientPdf(
      makeInput({
        includeClinicalData: false,
        anamnesis: makeAnamnesis(),
      }),
    );

    // PDF is generated successfully (anamnesis data is ignored)
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
  });

  // -- With clinical data --------------------------------------------------

  it('generates a different PDF when includeClinicalData is true with anamnesis', async () => {
    const pdfWithout = await generatePatientPdf(makeInput({ includeClinicalData: false }));
    const pdfWith = await generatePatientPdf(
      makeInput({
        includeClinicalData: true,
        anamnesis: makeAnamnesis(),
      }),
    );

    // The PDF with clinical data should be larger (more content)
    expect(pdfWith.length).toBeGreaterThan(pdfWithout.length);
  });

  it('generates PDF when includeClinicalData is true but anamnesis is null', async () => {
    const pdf = await generatePatientPdf(
      makeInput({
        includeClinicalData: true,
        anamnesis: null,
      }),
    );

    // Should still produce a valid PDF (with "Sem anamnese registrada")
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
  });

  // -- Minimal patient data ------------------------------------------------

  it('generates PDF with minimal data (only required fields)', async () => {
    const pdf = await generatePatientPdf(
      makeInput({
        birthDate: null,
        approximateAge: null,
        phone: null,
        email: null,
        cpf: null,
        address: null,
        profession: null,
        maritalStatus: null,
        source: null,
        tags: [],
        notes: null,
      }),
    );

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
  });

  // -- Approximate age instead of birth date --------------------------------

  it('generates PDF using approximate age when birthDate is null', async () => {
    const pdfWithAge = await generatePatientPdf(
      makeInput({
        birthDate: null,
        approximateAge: '30-35 anos',
      }),
    );

    const pdfWithBirth = await generatePatientPdf(
      makeInput({
        birthDate: new Date('1990-05-15T00:00:00-03:00'),
        approximateAge: null,
      }),
    );

    // Both should produce valid PDFs but with different content
    expect(Buffer.isBuffer(pdfWithAge)).toBe(true);
    expect(pdfWithAge.equals(pdfWithBirth)).toBe(false);
  });

  // -- Custom anamnesis sections -------------------------------------------

  it('generates a larger PDF when anamnesis has custom sections', async () => {
    const pdfWithoutCustom = await generatePatientPdf(
      makeInput({
        includeClinicalData: true,
        anamnesis: makeAnamnesis({ customSections: null }),
      }),
    );

    const pdfWithCustom = await generatePatientPdf(
      makeInput({
        includeClinicalData: true,
        anamnesis: makeAnamnesis({
          customSections: [
            { title: 'Relação com substâncias', content: 'Nega uso de substâncias.' },
            { title: 'Histórico social', content: 'Rede de apoio adequada.' },
          ],
        }),
      }),
    );

    // Custom sections add content → larger PDF
    expect(pdfWithCustom.length).toBeGreaterThan(pdfWithoutCustom.length);
  });

  // -- Psychologist header present -----------------------------------------

  it('includes psychologist name in Author metadata', async () => {
    const text = pdfToString(
      await generatePatientPdf(makeInput({ psychologistName: 'Dr. Antonio Silva' })),
    );

    // Author metadata is stored as a plain string (not UTF-16BE)
    expect(text).toContain('Dr. Antonio Silva');
  });
});
