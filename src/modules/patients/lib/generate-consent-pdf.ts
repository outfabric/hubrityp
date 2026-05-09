import PDFDocument from 'pdfkit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsentPdfInput = {
  termText: string;
  patientName: string;
  psychologistName: string;
  psychologistCrp: string;
  signedAt: Date;
  signedIp: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEGAL_NOTE = 'Documento assinado eletronicamente conforme MP 2.200-2/2001 art. 10, §2º';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Generates a PDF document for a signed consent term.
 *
 * Pure utility — no database or Supabase dependencies. Receives all data
 * needed to render the PDF and returns a Buffer.
 *
 * Layout:
 *   1. Header with title
 *   2. Psychologist identification (name + CRP)
 *   3. Patient name
 *   4. Full term text (justified)
 *   5. Signing block (timestamp + IP)
 *   6. Signature line with patient name
 *   7. Legal validity note (MP 2.200-2/2001)
 *
 * @returns A Buffer containing the PDF data.
 */
export async function generateConsentPdf(input: ConsentPdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    // pdfkit streams PDF data through a Node readable stream
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'Termo de Consentimento Informado',
        Author: input.psychologistName,
        Subject: 'Consentimento para tratamento psicológico',
      },
    });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Header ---
    doc.fontSize(16).text('Termo de Consentimento Informado', { align: 'center' }).moveDown(2);

    // --- Psychologist info ---
    doc
      .fontSize(10)
      .text(`Psicólogo(a): ${input.psychologistName}`)
      .text(`CRP: ${input.psychologistCrp}`)
      .moveDown(1);

    // --- Patient info ---
    doc.text(`Paciente: ${input.patientName}`).moveDown(1.5);

    // --- Term text ---
    doc.fontSize(11).text(input.termText, { align: 'justify' }).moveDown(2);

    // --- Signing metadata (audit trail) ---
    const formattedDate = input.signedAt.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'long',
      timeStyle: 'medium',
    });

    doc
      .fontSize(9)
      .text('--- Registro de assinatura eletrônica ---', { align: 'center' })
      .moveDown(0.5)
      .text(`Data/hora: ${formattedDate}`)
      .text(`IP: ${input.signedIp}`)
      .moveDown(2);

    // --- Signature line ---
    doc
      .fontSize(10)
      .text('_________________________________', { align: 'center' })
      .text(input.patientName, { align: 'center' })
      .text('(aceite eletrônico)', { align: 'center' })
      .moveDown(2);

    // --- Legal validity note ---
    doc.fontSize(8).text(LEGAL_NOTE, { align: 'center' });

    doc.end();
  });
}
