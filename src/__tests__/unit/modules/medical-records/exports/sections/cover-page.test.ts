import { describe, expect, it, vi } from 'vitest';

import type { ExportFilters } from '@/modules/medical-records/lib/exports/export-schemas';
import {
  renderCoverPage,
  type CoverPageData,
} from '@/modules/medical-records/lib/exports/sections/cover-page';

// ---------------------------------------------------------------------------
// Mock PDFKit doc — mirrors the pattern from clinical-documents/pdf-builder.test.ts
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
      width: 595, // A4
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

function makeDefaultFilters(): ExportFilters {
  return {
    dateRange: { from: null, to: null },
    sections: {
      anamnese: true,
      evolucoes: true,
      hipoteses: true,
      planoTerapeutico: true,
      escalas: true,
      documentos: true,
      anexosIndex: true,
    },
    includePersonalNotes: false,
  };
}

function makeCoverPageData(overrides?: Partial<CoverPageData>): CoverPageData {
  return {
    patient: {
      fullName: 'Maria da Silva Santos',
      birthDate: '1990-05-15T00:00:00.000Z',
      patientType: 'Adulto',
    },
    psychologist: {
      name: 'Dra. Ana Oliveira',
      crp: '06/123456',
      email: 'ana@clinica.com',
    },
    exportRequestedAt: new Date('2026-05-19T14:30:00.000Z'),
    filters: makeDefaultFilters(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderCoverPage', () => {
  it('writes the patient full name', () => {
    const mockDoc = createMockDoc();
    const data = makeCoverPageData();

    renderCoverPage(asPdfDoc(mockDoc), data);

    const textArgs = extractTextArgs(mockDoc);
    expect(textArgs).toContain('Maria da Silva Santos');
  });

  it('writes the psychologist name and CRP', () => {
    const mockDoc = createMockDoc();
    const data = makeCoverPageData();

    renderCoverPage(asPdfDoc(mockDoc), data);

    const textArgs = extractTextArgs(mockDoc);
    // Name and CRP are rendered via key-value pairs: "Nome: " continued + value
    // The doc.text mock captures each call; check both appear somewhere
    expect(textArgs.some((t) => t.includes('Dra. Ana Oliveira'))).toBe(true);
    expect(textArgs.some((t) => t.includes('06/123456'))).toBe(true);
  });

  it('writes the export timestamp', () => {
    const mockDoc = createMockDoc();
    const data = makeCoverPageData({
      exportRequestedAt: new Date('2026-05-19T14:30:00.000Z'),
    });

    renderCoverPage(asPdfDoc(mockDoc), data);

    const textArgs = extractTextArgs(mockDoc);
    // Timestamp is formatted as DD/MM/YYYY as HH:mm
    // (UTC offset means the exact displayed time depends on system timezone,
    // so we check the "Data/hora da solicitação: " label appears)
    expect(textArgs.some((t) => t.includes('Data/hora da solicitação: '))).toBe(true);
  });

  it('writes "Completo (sem filtro de data)" when no date range is set', () => {
    const mockDoc = createMockDoc();
    const data = makeCoverPageData();

    renderCoverPage(asPdfDoc(mockDoc), data);

    const textArgs = extractTextArgs(mockDoc);
    expect(textArgs).toContain('Completo (sem filtro de data)');
  });

  it('writes the date range when from/to are set', () => {
    const mockDoc = createMockDoc();
    const data = makeCoverPageData({
      filters: {
        ...makeDefaultFilters(),
        dateRange: {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-06-30T00:00:00.000Z',
        },
      },
    });

    renderCoverPage(asPdfDoc(mockDoc), data);

    const textArgs = extractTextArgs(mockDoc);
    expect(textArgs.some((t) => t.includes('De '))).toBe(true);
    expect(textArgs.some((t) => t.includes('Até '))).toBe(true);
  });

  it('writes section toggle checklist including [x] and [ ] markers', () => {
    const mockDoc = createMockDoc();
    const data = makeCoverPageData({
      filters: {
        ...makeDefaultFilters(),
        sections: {
          ...makeDefaultFilters().sections,
          documentos: false,
          escalas: false,
        },
      },
    });

    renderCoverPage(asPdfDoc(mockDoc), data);

    const textArgs = extractTextArgs(mockDoc);

    // Enabled sections should have [x]
    expect(textArgs).toContain('[x] Anamnese');
    expect(textArgs).toContain('[x] Evoluções');
    // Disabled sections should have [ ]
    expect(textArgs).toContain('[ ] Documentos clínicos');
    expect(textArgs).toContain('[ ] Escalas');
  });

  it('writes includePersonalNotes toggle state', () => {
    const mockDoc = createMockDoc();
    const data = makeCoverPageData({
      filters: {
        ...makeDefaultFilters(),
        includePersonalNotes: true,
      },
    });

    renderCoverPage(asPdfDoc(mockDoc), data);

    const textArgs = extractTextArgs(mockDoc);
    expect(textArgs).toContain('[x] Anotações pessoais');
  });

  it('writes title "Prontuário Psicológico"', () => {
    const mockDoc = createMockDoc();
    renderCoverPage(asPdfDoc(mockDoc), makeCoverPageData());

    const textArgs = extractTextArgs(mockDoc);
    expect(textArgs).toContain('Prontuário Psicológico');
  });

  it('writes subtitle "Exportação de Prontuário"', () => {
    const mockDoc = createMockDoc();
    renderCoverPage(asPdfDoc(mockDoc), makeCoverPageData());

    const textArgs = extractTextArgs(mockDoc);
    expect(textArgs).toContain('Exportação de Prontuário');
  });
});
