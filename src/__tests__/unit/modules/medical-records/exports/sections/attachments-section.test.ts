import { describe, expect, it, vi } from 'vitest';

import {
  renderAttachmentsSection,
  type AttachmentRow,
} from '@/modules/medical-records/lib/exports/sections/attachments-section';

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

function makeAttachment(overrides?: Partial<AttachmentRow>): AttachmentRow {
  return {
    displayName: 'exame-sangue.pdf',
    category: 'exam',
    fileSize: 245_760, // ~240 KB
    uploadedAt: new Date('2026-03-10T14:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderAttachmentsSection', () => {
  it('renders the section title "Indice de Anexos"', () => {
    const mockDoc = createMockDoc();
    renderAttachmentsSection(asPdfDoc(mockDoc), []);

    const textArgs = mockDoc.text.mock.calls.map((c: unknown[]) => c[0]);
    expect(textArgs).toContain('Indice de Anexos');
  });

  // ---------------------------------------------------------------------------
  // Empty attachments
  // ---------------------------------------------------------------------------

  describe('empty attachments', () => {
    it('renders "Nenhum anexo registrado." when empty', () => {
      const mockDoc = createMockDoc();
      renderAttachmentsSection(asPdfDoc(mockDoc), []);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Nenhum anexo registrado.');
    });
  });

  // ---------------------------------------------------------------------------
  // Category summary
  // ---------------------------------------------------------------------------

  describe('category summary', () => {
    it('renders a summary line with category counts', () => {
      const attachments: AttachmentRow[] = [
        makeAttachment({ category: 'image', displayName: 'foto1.jpg' }),
        makeAttachment({ category: 'image', displayName: 'foto2.jpg' }),
        makeAttachment({ category: 'exam', displayName: 'exame.pdf' }),
      ];

      const mockDoc = createMockDoc();
      renderAttachmentsSection(asPdfDoc(mockDoc), attachments);

      const textArgs = extractTextArgs(mockDoc);
      // The summary joins category labels with counts
      const summaryLine = textArgs.find((t) => t.includes('Imagens: 2'));
      expect(summaryLine).toBeDefined();
      expect(summaryLine).toContain('Exames: 1');
    });

    it('maps known category keys to Portuguese labels', () => {
      const attachments: AttachmentRow[] = [
        makeAttachment({ category: 'drawing' }),
        makeAttachment({ category: 'audio' }),
        makeAttachment({ category: 'other' }),
      ];

      const mockDoc = createMockDoc();
      renderAttachmentsSection(asPdfDoc(mockDoc), attachments);

      const textArgs = extractTextArgs(mockDoc);
      const summaryLine = textArgs.find((t) => t.includes('Desenhos: 1'));
      expect(summaryLine).toBeDefined();
      expect(summaryLine).toContain('Audios: 1');
      expect(summaryLine).toContain('Outros: 1');
    });
  });

  // ---------------------------------------------------------------------------
  // Table headers
  // ---------------------------------------------------------------------------

  describe('table headers', () => {
    it('renders column headers: Nome, Categoria, Tamanho, Data de upload', () => {
      const mockDoc = createMockDoc();
      renderAttachmentsSection(asPdfDoc(mockDoc), [makeAttachment()]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Nome');
      expect(textArgs).toContain('Categoria');
      expect(textArgs).toContain('Tamanho');
      expect(textArgs).toContain('Data de upload');
    });
  });

  // ---------------------------------------------------------------------------
  // Row data rendering
  // ---------------------------------------------------------------------------

  describe('row rendering', () => {
    it('renders display_name, category label, size, and date for each attachment', () => {
      const attachments: AttachmentRow[] = [
        makeAttachment({
          displayName: 'ressonancia.pdf',
          category: 'exam',
          fileSize: 2_500_000, // ~2.4 MB
          uploadedAt: new Date('2026-04-20T10:00:00.000Z'),
        }),
        makeAttachment({
          displayName: 'desenho-familia.png',
          category: 'drawing',
          fileSize: 150_000, // ~146.5 KB
          uploadedAt: new Date('2026-05-01T09:00:00.000Z'),
        }),
      ];

      const mockDoc = createMockDoc();
      renderAttachmentsSection(asPdfDoc(mockDoc), attachments);

      const textArgs = extractTextArgs(mockDoc);

      // Display names
      expect(textArgs).toContain('ressonancia.pdf');
      expect(textArgs).toContain('desenho-familia.png');

      // Category labels (Portuguese)
      expect(textArgs).toContain('Exames');
      expect(textArgs).toContain('Desenhos');

      // File sizes formatted
      expect(textArgs).toContain('2.4 MB');
      expect(textArgs).toContain('146.5 KB');

      // Dates formatted as DD/MM/YYYY
      expect(textArgs).toContain('20/04/2026');
      expect(textArgs).toContain('01/05/2026');
    });
  });

  // ---------------------------------------------------------------------------
  // File size formatting
  // ---------------------------------------------------------------------------

  describe('file size formatting', () => {
    it('formats bytes correctly', () => {
      const mockDoc = createMockDoc();
      renderAttachmentsSection(asPdfDoc(mockDoc), [makeAttachment({ fileSize: 500 })]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('500 B');
    });

    it('formats KB correctly', () => {
      const mockDoc = createMockDoc();
      renderAttachmentsSection(asPdfDoc(mockDoc), [makeAttachment({ fileSize: 1024 })]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('1.0 KB');
    });
  });

  // ---------------------------------------------------------------------------
  // Table structure
  // ---------------------------------------------------------------------------

  describe('table structure', () => {
    it('draws a header underline', () => {
      const mockDoc = createMockDoc();
      renderAttachmentsSection(asPdfDoc(mockDoc), [makeAttachment()]);

      expect(mockDoc.moveTo).toHaveBeenCalled();
      expect(mockDoc.lineTo).toHaveBeenCalled();
      expect(mockDoc.stroke).toHaveBeenCalled();
    });
  });
});
