import { describe, expect, it, vi } from 'vitest';

import {
  renderEvolutionsSection,
  type EvolutionForExport,
} from '@/modules/medical-records/lib/exports/sections/evolutions-section';

// ---------------------------------------------------------------------------
// Mock htmlToText — evolutions-section imports it from the pdf module.
// We mock it so unit tests are isolated from the HTML parser.
// ---------------------------------------------------------------------------

vi.mock('@/modules/medical-records/lib/pdf/html-to-text', () => ({
  htmlToText: (html: string | null | undefined) => {
    if (!html) return '';
    // Strip HTML tags for a minimal mock
    return html.replace(/<[^>]*>/g, '').trim();
  },
}));

// ---------------------------------------------------------------------------
// Mock PDFKit doc
// ---------------------------------------------------------------------------

interface MockPdfDoc {
  text: ReturnType<typeof vi.fn>;
  font: ReturnType<typeof vi.fn>;
  fontSize: ReturnType<typeof vi.fn>;
  moveDown: ReturnType<typeof vi.fn>;
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

function makeEvolution(overrides?: Partial<EvolutionForExport>): EvolutionForExport {
  return {
    id: 'evo-1',
    templateType: 'livre',
    content: { content: '<p>Sessao produtiva</p>' },
    createdAt: new Date('2026-01-15T10:00:00.000Z'),
    finalizedAt: new Date('2026-01-15T11:00:00.000Z'),
    addenda: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderEvolutionsSection', () => {
  it('renders the section title "Evolucoes"', () => {
    const mockDoc = createMockDoc();
    renderEvolutionsSection(asPdfDoc(mockDoc), []);

    const textArgs = extractTextArgs(mockDoc);
    expect(textArgs).toContain('Evolucoes');
  });

  // ---------------------------------------------------------------------------
  // Empty evolutions
  // ---------------------------------------------------------------------------

  describe('empty evolutions', () => {
    it('renders "Nenhuma evolucao no periodo selecionado." when empty', () => {
      const mockDoc = createMockDoc();
      renderEvolutionsSection(asPdfDoc(mockDoc), []);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Nenhuma evolucao no periodo selecionado.');
    });
  });

  // ---------------------------------------------------------------------------
  // Monthly grouping
  // ---------------------------------------------------------------------------

  describe('monthly grouping', () => {
    it('renders month headers for evolutions across 2 months', () => {
      const evolutions: EvolutionForExport[] = [
        makeEvolution({ id: 'e1', createdAt: new Date('2026-01-10T10:00:00.000Z') }),
        makeEvolution({ id: 'e2', createdAt: new Date('2026-01-20T10:00:00.000Z') }),
        makeEvolution({ id: 'e3', createdAt: new Date('2026-02-15T10:00:00.000Z') }),
      ];

      const mockDoc = createMockDoc();
      renderEvolutionsSection(asPdfDoc(mockDoc), evolutions);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Janeiro 2026');
      expect(textArgs).toContain('Fevereiro 2026');
    });

    it('renders "Janeiro 2026" only once even with 2 evolutions in January', () => {
      const evolutions: EvolutionForExport[] = [
        makeEvolution({ id: 'e1', createdAt: new Date('2026-01-10T10:00:00.000Z') }),
        makeEvolution({ id: 'e2', createdAt: new Date('2026-01-20T10:00:00.000Z') }),
      ];

      const mockDoc = createMockDoc();
      renderEvolutionsSection(asPdfDoc(mockDoc), evolutions);

      const textArgs = extractTextArgs(mockDoc);
      const januaryCount = textArgs.filter((t) => t === 'Janeiro 2026').length;
      expect(januaryCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Template-aware rendering
  // ---------------------------------------------------------------------------

  describe('template-aware rendering', () => {
    it('renders "livre" template content with "Conteudo" label', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({
        templateType: 'livre',
        content: { content: 'Paciente relatou melhora' },
      });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Conteudo');
      expect(textArgs.some((t) => t.includes('Paciente relatou melhora'))).toBe(true);
    });

    it('renders "tcc" template fields with appropriate labels', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({
        templateType: 'tcc',
        content: {
          situation: 'Conflito no trabalho',
          automaticThought: 'Ninguem me valoriza',
          emotion: 'Tristeza',
          behavior: 'Isolamento',
          intervention: 'Reestruturacao cognitiva',
          homework: 'Diario de pensamentos',
          notes: 'Paciente engajado',
        },
      });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Situacao');
      expect(textArgs).toContain('Pensamento automatico');
      expect(textArgs).toContain('Emocao');
      expect(textArgs).toContain('Comportamento');
      expect(textArgs).toContain('Intervencao');
      expect(textArgs).toContain('Tarefa de casa');
      expect(textArgs).toContain('Observacoes');
    });

    it('renders "psicanalise" template fields with appropriate labels', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({
        templateType: 'psicanalise',
        content: {
          manifest: 'Relato do sonho',
          latent: 'Medo de abandono',
          transference: 'Transferencia positiva',
          interpretation: 'Interpretacao simbolica',
          notes: 'Sessao intensa',
        },
      });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Conteudo manifesto');
      expect(textArgs).toContain('Conteudo latente');
      expect(textArgs).toContain('Transferencia');
      expect(textArgs).toContain('Interpretacao');
      expect(textArgs).toContain('Observacoes');
    });

    it('falls back to generic rendering for unknown template type', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({
        templateType: 'custom_unknown',
        content: { someField: 'Some value' },
      });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs.some((t) => t.includes('Campo (someField)'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Addendum rendering
  // ---------------------------------------------------------------------------

  describe('addendum rendering', () => {
    it('renders addendum header "Adendos:" when evolution has addenda', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({
        addenda: [
          {
            versionNumber: 2,
            content: { content: 'Correcao do relato' },
            reason: 'Erro de digitacao',
            createdAt: new Date('2026-01-16T09:00:00.000Z'),
          },
        ],
      });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).toContain('Adendos:');
    });

    it('renders addendum version number and reason', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({
        addenda: [
          {
            versionNumber: 2,
            content: { content: 'Correcao do relato' },
            reason: 'Complemento solicitado pelo paciente',
            createdAt: new Date('2026-01-16T09:00:00.000Z'),
          },
        ],
      });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs.some((t) => t.includes('Versao 2'))).toBe(true);
      expect(textArgs.some((t) => t.includes('Motivo: Complemento solicitado pelo paciente'))).toBe(
        true,
      );
    });

    it('renders addendum content text', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({
        addenda: [
          {
            versionNumber: 2,
            content: { content: 'Complemento terapeutico adicionado' },
            reason: null,
            createdAt: new Date('2026-01-16T09:00:00.000Z'),
          },
        ],
      });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs.some((t) => t.includes('Complemento terapeutico adicionado'))).toBe(true);
    });

    it('does not render "Adendos:" when addenda array is empty', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({ addenda: [] });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs).not.toContain('Adendos:');
    });
  });

  // ---------------------------------------------------------------------------
  // Status rendering
  // ---------------------------------------------------------------------------

  describe('finalization status', () => {
    it('renders "Finalizada" for finalized evolutions', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({
        finalizedAt: new Date('2026-01-15T11:00:00.000Z'),
      });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs.some((t) => t.includes('Finalizada'))).toBe(true);
    });

    it('renders "Rascunho" for draft evolutions', () => {
      const mockDoc = createMockDoc();
      const evo = makeEvolution({ finalizedAt: null });

      renderEvolutionsSection(asPdfDoc(mockDoc), [evo]);

      const textArgs = extractTextArgs(mockDoc);
      expect(textArgs.some((t) => t.includes('Rascunho'))).toBe(true);
    });
  });
});
