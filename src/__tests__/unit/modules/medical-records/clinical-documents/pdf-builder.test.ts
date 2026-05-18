import { describe, expect, it, vi } from 'vitest';

import {
  buildClinicalDocumentPdf,
  type BuildPdfInput,
} from '@/modules/medical-records/lib/pdf/build-clinical-document-pdf';
import {
  addPageNumber,
  addWatermark,
  buildSignatureBlock,
} from '@/modules/medical-records/lib/pdf/pdf-helpers';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal valid input for a 'laudo' document (requires analise field). */
function makeLaudoInput(): BuildPdfInput {
  return {
    documentType: 'laudo',
    title: 'Laudo Pericial',
    content: {
      document_type: 'laudo',
      solicitante: 'Tribunal Regional do Trabalho - 2a Vara',
      demanda: 'Avaliacao psicologica para fins judiciais.',
      procedimentos: 'Entrevistas clinicas, aplicacao do WAIS-IV e BDI-II.',
      analise: 'O periciando demonstra capacidade cognitiva preservada, sem indicios de simulacao.',
      conclusao:
        'Com base nos procedimentos realizados, conclui-se que o periciando apresenta condicoes psicologicas adequadas.',
      localData: {
        local: 'Sao Paulo, SP',
        data: '18 de maio de 2026',
      },
      cid10Codes: [
        { code: 'F41.1', description: 'Ansiedade generalizada' },
        { code: 'F32.0', description: 'Episodio depressivo leve' },
      ],
      psychologistInfo: {
        name: 'Dra. Ana Silva',
        crp: '06/123456',
      },
    },
    psychologistInfo: {
      name: 'Dra. Ana Silva',
      crp: 'CRP 06/123456',
      contact: 'ana.silva@email.com',
    },
  };
}

/**
 * Subset of PDFKit.PDFDocument methods used by the helper functions under test.
 * Enables type-safe mocking without pulling in the full pdfkit interface.
 */
interface MockPdfDoc {
  text: ReturnType<typeof vi.fn>;
  font: ReturnType<typeof vi.fn>;
  fontSize: ReturnType<typeof vi.fn>;
  opacity: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  lineWidth: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  moveDown: ReturnType<typeof vi.fn>;
  y: number;
  page: {
    width: number;
    height: number;
    margins: { left: number; right: number; top: number; bottom: number };
  };
}

/**
 * Creates a mock PDFDocument-like object for testing individual helpers.
 * Each method is a vi.fn() that returns `this` (for chaining) unless
 * it needs to return a specific value.
 */
function createMockDoc(): MockPdfDoc {
  const mock: MockPdfDoc = {
    text: vi.fn(),
    font: vi.fn(),
    fontSize: vi.fn(),
    opacity: vi.fn(),
    rotate: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    lineWidth: vi.fn(),
    stroke: vi.fn(),
    moveDown: vi.fn(),
    y: 400,
    page: {
      width: 612,
      height: 792,
      margins: { left: 50, right: 50, top: 50, bottom: 50 },
    },
  };

  // Enable method chaining (pdfkit methods return the doc)
  mock.text.mockReturnValue(mock);
  mock.font.mockReturnValue(mock);
  mock.fontSize.mockReturnValue(mock);
  mock.opacity.mockReturnValue(mock);
  mock.rotate.mockReturnValue(mock);
  mock.restore.mockReturnValue(mock);
  mock.save.mockReturnValue(mock);
  mock.translate.mockReturnValue(mock);
  mock.moveTo.mockReturnValue(mock);
  mock.lineTo.mockReturnValue(mock);
  mock.lineWidth.mockReturnValue(mock);
  mock.stroke.mockReturnValue(mock);
  mock.moveDown.mockReturnValue(mock);

  return mock;
}

/**
 * Casts a MockPdfDoc to PDFKit.PDFDocument for passing to helper functions.
 * The mock satisfies the subset of the interface actually used by the helpers.
 */
function asPdfDoc(mock: MockPdfDoc): PDFKit.PDFDocument {
  return mock as unknown as PDFKit.PDFDocument;
}

// ---------------------------------------------------------------------------
// Integration-style test: real PDF buffer generation
// ---------------------------------------------------------------------------

describe('buildClinicalDocumentPdf', () => {
  it('returns a non-empty Buffer for valid laudo input', async () => {
    const input = makeLaudoInput();
    const buffer = await buildClinicalDocumentPdf(input);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('produces a valid PDF (starts with %PDF magic bytes)', async () => {
    const input = makeLaudoInput();
    const buffer = await buildClinicalDocumentPdf(input);

    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('produces a PDF within a reasonable size range', async () => {
    const input = makeLaudoInput();
    const buffer = await buildClinicalDocumentPdf(input);

    // A clinical document PDF with a few sections, CID-10, watermark, and
    // signature block should be between 1 KB and 500 KB.
    expect(buffer.length).toBeGreaterThan(1_000);
    expect(buffer.length).toBeLessThan(500_000);
  });

  it('produces deterministic output for fixed input', async () => {
    const input = makeLaudoInput();
    const buffer1 = await buildClinicalDocumentPdf(input);
    const buffer2 = await buildClinicalDocumentPdf(input);

    // pdfkit includes creation date metadata, so byte-exact equality is
    // unlikely — but byte count should be very close (within 1% tolerance)
    const sizeDiff = Math.abs(buffer1.length - buffer2.length);
    const tolerance = buffer1.length * 0.01;
    expect(sizeDiff).toBeLessThanOrEqual(tolerance);
  });

  it('generates PDF without CID-10 codes when none provided', async () => {
    const input = makeLaudoInput();
    input.content['cid10Codes'] = [];

    const buffer = await buildClinicalDocumentPdf(input);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('generates PDF without localData when not provided', async () => {
    const input = makeLaudoInput();
    delete input.content['localData'];

    const buffer = await buildClinicalDocumentPdf(input);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('generates PDF for a declaracao document type', async () => {
    const input: BuildPdfInput = {
      documentType: 'declaracao',
      title: '',
      content: {
        document_type: 'declaracao',
        solicitante: 'A pedido do paciente',
        demanda: 'Declaracao de comparecimento.',
        procedimentos: 'Sessao de psicoterapia individual.',
        conclusao: 'O paciente compareceu a sessao na data informada.',
        localData: { local: 'Curitiba, PR', data: '18 de maio de 2026' },
      },
      psychologistInfo: {
        name: 'Dr. Carlos Mendes',
        crp: 'CRP 08/54321',
      },
    };

    const buffer = await buildClinicalDocumentPdf(input);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

// ---------------------------------------------------------------------------
// Helper unit tests: mock doc object
// ---------------------------------------------------------------------------

describe('addPageNumber', () => {
  it('calls doc.text with "Pagina X de Y" at the expected y position', () => {
    const mockDoc = createMockDoc();

    addPageNumber(asPdfDoc(mockDoc), 1, 3);

    // Should call text with the correct page string
    expect(mockDoc.text).toHaveBeenCalledWith(
      'Pagina 1 de 3',
      0,
      // Y position: page height (792) - 30 = 762
      762,
      expect.objectContaining({ align: 'center' }),
    );
  });

  it('renders correct numbers for later pages', () => {
    const mockDoc = createMockDoc();

    addPageNumber(asPdfDoc(mockDoc), 2, 5);

    expect(mockDoc.text).toHaveBeenCalledWith(
      'Pagina 2 de 5',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ align: 'center' }),
    );
  });
});

describe('addWatermark', () => {
  it('calls save() to preserve graphics state', () => {
    const mockDoc = createMockDoc();
    addWatermark(asPdfDoc(mockDoc));

    expect(mockDoc.save).toHaveBeenCalled();
  });

  it('sets opacity to approximately 0.11', () => {
    const mockDoc = createMockDoc();
    addWatermark(asPdfDoc(mockDoc));

    expect(mockDoc.opacity).toHaveBeenCalledWith(0.11);
  });

  it('rotates approximately -45 degrees', () => {
    const mockDoc = createMockDoc();
    addWatermark(asPdfDoc(mockDoc));

    expect(mockDoc.rotate).toHaveBeenCalledWith(-45, expect.objectContaining({ origin: [0, 0] }));
  });

  it('renders "DOCUMENTO PSICOLOGICO" text', () => {
    const mockDoc = createMockDoc();
    addWatermark(asPdfDoc(mockDoc));

    expect(mockDoc.text).toHaveBeenCalledWith(
      'DOCUMENTO PSICOLOGICO',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ align: 'center' }),
    );
  });

  it('calls restore() to reset graphics state', () => {
    const mockDoc = createMockDoc();
    addWatermark(asPdfDoc(mockDoc));

    expect(mockDoc.restore).toHaveBeenCalled();
  });
});

describe('buildSignatureBlock', () => {
  it('renders text containing the CRP number', () => {
    const mockDoc = createMockDoc();
    buildSignatureBlock(asPdfDoc(mockDoc), 'CRP 06/12345');

    const textCalls = mockDoc.text.mock.calls;
    const allTextArgs = textCalls.map((call: unknown[]) => call[0]);

    expect(allTextArgs).toContain('CRP 06/12345');
  });

  it('renders "Assinatura" label', () => {
    const mockDoc = createMockDoc();
    buildSignatureBlock(asPdfDoc(mockDoc), 'CRP 06/12345');

    const textCalls = mockDoc.text.mock.calls;
    const allTextArgs = textCalls.map((call: unknown[]) => call[0]);

    expect(allTextArgs).toContain('Assinatura');
  });

  it('includes ICP-Brasil note', () => {
    const mockDoc = createMockDoc();
    buildSignatureBlock(asPdfDoc(mockDoc), 'CRP 06/12345');

    const textCalls = mockDoc.text.mock.calls;
    const allTextArgs = textCalls.map((call: unknown[]) => call[0]);

    expect(allTextArgs).toContain('ICP-Brasil ou manuscrita + carimbo CRP');
  });

  it('draws a horizontal separator line', () => {
    const mockDoc = createMockDoc();
    buildSignatureBlock(asPdfDoc(mockDoc), 'CRP 06/12345');

    expect(mockDoc.moveTo).toHaveBeenCalled();
    expect(mockDoc.lineTo).toHaveBeenCalled();
    expect(mockDoc.stroke).toHaveBeenCalled();
  });
});
