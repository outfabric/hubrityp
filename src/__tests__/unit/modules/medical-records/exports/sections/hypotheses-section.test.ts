import { describe, expect, it, vi } from 'vitest';

import {
  renderHypothesesSection,
  type HypothesisRow,
} from '@/modules/medical-records/lib/exports/sections/hypotheses-section';

// ---------------------------------------------------------------------------
// Mock PDFKit doc
// ---------------------------------------------------------------------------

interface MockPdfDoc {
  text: ReturnType<typeof vi.fn>;
  font: ReturnType<typeof vi.fn>;
  fontSize: ReturnType<typeof vi.fn>;
  moveDown: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  lineWidth: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  y: number;
  x: number;
  page: {
    width: number;
    height: number;
    margins: { left: number; right: number; top: number; bottom: number };
  };
}

function createMockDoc(): MockPdfDoc {
  const mock: MockPdfDoc = {
    text: vi.fn(),
    font: vi.fn(),
    fontSize: vi.fn(),
    moveDown: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    lineWidth: vi.fn(),
    stroke: vi.fn(),
    y: 50,
    x: 50,
    page: {
      width: 595,
      height: 842,
      margins: { left: 50, right: 50, top: 50, bottom: 50 },
    },
  };

  mock.text.mockReturnValue(mock);
  mock.font.mockReturnValue(mock);
  mock.fontSize.mockReturnValue(mock);
  mock.moveDown.mockReturnValue(mock);
  mock.moveTo.mockReturnValue(mock);
  mock.lineTo.mockReturnValue(mock);
  mock.lineWidth.mockReturnValue(mock);
  mock.stroke.mockReturnValue(mock);

  return mock;
}

function asPdfDoc(mock: MockPdfDoc): PDFKit.PDFDocument {
  return mock as unknown as PDFKit.PDFDocument;
}

/** Extract all first-argument strings from doc.text() calls for assertion. */
function extractTextArgs(mock: MockPdfDoc): string[] {
  return mock.text.mock.calls.map((c: unknown[]) => String(c[0]));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeHypothesis(overrides?: Partial<HypothesisRow>): HypothesisRow {
  return {
    cid10Code: 'F41.1',
    description: 'Transtorno de ansiedade generalizada',
    cid10Description: null,
    status: 'confirmed',
    createdAt: new Date('2026-02-10T10:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderHypothesesSection', () => {
  it('renders the section title "Hipoteses Diagnosticas"', () => {
    const mockDoc = createMockDoc();
    renderHypothesesSection(asPdfDoc(mockDoc), []);

    const textArgs = mockDoc.text.mock.calls.map((c: unknown[]) => c[0]);
    expect(textArgs).toContain('Hipoteses Diagnosticas');
  });

  // ---------------------------------------------------------------------------
  // Empty hypotheses
  // ---------------------------------------------------------------------------

  describe('empty hypotheses', () => {
    it('renders "Nenhuma hipotese diagnostica registrada." when empty', () => {
      const mockDoc = createMockDoc();
      renderHypothesesSection(asPdfDoc(mockDoc), []);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Nenhuma hipotese diagnostica registrada.');
    });
  });

  // ---------------------------------------------------------------------------
  // Table headers
  // ---------------------------------------------------------------------------

  describe('table headers', () => {
    it('renders column headers: CID-10, Descricao, Status, Data', () => {
      const mockDoc = createMockDoc();
      renderHypothesesSection(asPdfDoc(mockDoc), [makeHypothesis()]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('CID-10');
      expect(textArgs).toContain('Descrição');
      expect(textArgs).toContain('Status');
      expect(textArgs).toContain('Data');
    });
  });

  // ---------------------------------------------------------------------------
  // Row data rendering
  // ---------------------------------------------------------------------------

  describe('row rendering', () => {
    it('renders CID-10 code, description, status, and date for each hypothesis', () => {
      const hypotheses: HypothesisRow[] = [
        makeHypothesis({
          cid10Code: 'F41.1',
          description: 'Transtorno de ansiedade generalizada',
          status: 'confirmed',
          createdAt: new Date('2026-02-10T10:00:00.000Z'),
        }),
        makeHypothesis({
          cid10Code: 'F32.0',
          description: 'Episodio depressivo leve',
          status: 'investigating',
          createdAt: new Date('2026-03-05T10:00:00.000Z'),
        }),
      ];

      const mockDoc = createMockDoc();
      renderHypothesesSection(asPdfDoc(mockDoc), hypotheses);

      const textArgs = extractTextArgs(mockDoc);

      // CID-10 codes
      expect(textArgs).toContain('F41.1');
      expect(textArgs).toContain('F32.0');

      // Descriptions
      expect(textArgs).toContain('Transtorno de ansiedade generalizada');
      expect(textArgs).toContain('Episodio depressivo leve');

      // Status labels in Portuguese
      expect(textArgs).toContain('Confirmada');
      expect(textArgs).toContain('Em investigação');

      // Dates formatted as DD/MM/YYYY
      expect(textArgs).toContain('10/02/2026');
      expect(textArgs).toContain('05/03/2026');
    });
  });

  // ---------------------------------------------------------------------------
  // Status label mapping
  // ---------------------------------------------------------------------------

  describe('status labels', () => {
    it.each([
      ['confirmed', 'Confirmada'],
      ['investigating', 'Em investigação'],
      ['discarded', 'Descartada'],
    ])('maps status "%s" to Portuguese label "%s"', (status, expectedLabel) => {
      const mockDoc = createMockDoc();
      renderHypothesesSection(asPdfDoc(mockDoc), [makeHypothesis({ status })]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain(expectedLabel);
    });

    it('renders raw status string for unknown status values', () => {
      const mockDoc = createMockDoc();
      renderHypothesesSection(asPdfDoc(mockDoc), [makeHypothesis({ status: 'custom_status' })]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('custom_status');
    });
  });

  // ---------------------------------------------------------------------------
  // Null CID-10 code
  // ---------------------------------------------------------------------------

  describe('null CID-10 code', () => {
    it('renders "-" when cid10Code is null', () => {
      const mockDoc = createMockDoc();
      renderHypothesesSection(asPdfDoc(mockDoc), [makeHypothesis({ cid10Code: null })]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('-');
    });
  });

  // ---------------------------------------------------------------------------
  // Separator line
  // ---------------------------------------------------------------------------

  describe('table structure', () => {
    it('draws a header underline', () => {
      const mockDoc = createMockDoc();
      renderHypothesesSection(asPdfDoc(mockDoc), [makeHypothesis()]);

      expect(mockDoc.moveTo).toHaveBeenCalled();
      expect(mockDoc.lineTo).toHaveBeenCalled();
      expect(mockDoc.stroke).toHaveBeenCalled();
    });
  });
});
