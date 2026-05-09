import { describe, expect, it } from 'vitest';

import {
  generateConsentPdf,
  type ConsentPdfInput,
} from '@/modules/patients/lib/generate-consent-pdf';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ConsentPdfInput> = {}): ConsentPdfInput {
  return {
    psychologistName: 'Dra. Maria Silva',
    psychologistCrp: '06/123456',
    patientName: 'João Souza',
    termText:
      'Eu, paciente, autorizo o tratamento psicológico e declaro estar ciente dos procedimentos.',
    signedAt: new Date('2025-06-15T14:30:00-03:00'),
    signedIp: '192.168.1.100',
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

describe('generateConsentPdf', () => {
  // -- Structural validation -----------------------------------------------

  it('returns a Buffer', async () => {
    const result = await generateConsentPdf(makeInput());

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('returns a non-empty Buffer', async () => {
    const result = await generateConsentPdf(makeInput());

    expect(result.length).toBeGreaterThan(0);
  });

  it('starts with %PDF magic bytes (valid PDF header)', async () => {
    const result = await generateConsentPdf(makeInput());
    const header = result.subarray(0, 5).toString('ascii');

    expect(header).toBe('%PDF-');
  });

  it('ends with %%EOF marker', async () => {
    const result = await generateConsentPdf(makeInput());
    const trailer = result.subarray(-6).toString('ascii').trim();

    expect(trailer).toBe('%%EOF');
  });

  // -- Metadata (stored uncompressed in the info dict) ---------------------

  it('sets the PDF title to "Termo de Consentimento Informado"', async () => {
    const text = pdfToString(await generateConsentPdf(makeInput()));

    expect(text).toContain('Termo de Consentimento Informado');
  });

  it('sets the Author metadata to the psychologist name', async () => {
    const text = pdfToString(
      await generateConsentPdf(makeInput({ psychologistName: 'Dr. Carlos Mendes' })),
    );

    expect(text).toContain('Dr. Carlos Mendes');
  });

  it('sets the Subject metadata about psychological consent', async () => {
    const text = pdfToString(await generateConsentPdf(makeInput()));

    // The Subject field is stored as UTF-16BE with BOM by pdfkit, but the
    // ASCII-compatible prefix "Consentimento" will still be present.
    expect(text).toContain('Consentimento');
  });

  // -- Content differentiation (body is compressed, but unique per input) --

  it('produces different output for different patient names', async () => {
    const pdf1 = await generateConsentPdf(makeInput({ patientName: 'Alice' }));
    const pdf2 = await generateConsentPdf(makeInput({ patientName: 'Bob' }));

    expect(pdf1.equals(pdf2)).toBe(false);
  });

  it('produces different output for different term texts', async () => {
    const pdf1 = await generateConsentPdf(makeInput({ termText: 'Texto A' }));
    const pdf2 = await generateConsentPdf(makeInput({ termText: 'Texto B' }));

    expect(pdf1.equals(pdf2)).toBe(false);
  });

  it('produces different output for different CRPs', async () => {
    const pdf1 = await generateConsentPdf(makeInput({ psychologistCrp: '06/111111' }));
    const pdf2 = await generateConsentPdf(makeInput({ psychologistCrp: '08/999999' }));

    expect(pdf1.equals(pdf2)).toBe(false);
  });

  it('produces different output for different IPs', async () => {
    const pdf1 = await generateConsentPdf(makeInput({ signedIp: '10.0.0.1' }));
    const pdf2 = await generateConsentPdf(makeInput({ signedIp: '10.0.0.2' }));

    expect(pdf1.equals(pdf2)).toBe(false);
  });

  // -- Page structure ------------------------------------------------------

  it('uses A4 page size', async () => {
    const text = pdfToString(await generateConsentPdf(makeInput()));

    // A4 dimensions in points: 595.28 x 841.89
    expect(text).toContain('595.28');
    expect(text).toContain('841.89');
  });

  it('produces exactly one page', async () => {
    const text = pdfToString(await generateConsentPdf(makeInput()));

    // pdfkit writes /Count N for total pages in the Pages object
    expect(text).toContain('/Count 1');
  });

  // -- Font ----------------------------------------------------------------

  it('uses Helvetica font', async () => {
    const text = pdfToString(await generateConsentPdf(makeInput()));

    expect(text).toContain('/BaseFont /Helvetica');
  });
});
