import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted: mock fns created before vi.mock hoisting runs, so factories
// can safely reference them.
// ---------------------------------------------------------------------------

const {
  mockRenderCoverPage,
  mockRenderAnamnesisSection,
  mockRenderEvolutionsSection,
  mockRenderHypothesesSection,
  mockRenderTreatmentPlanSection,
  mockRenderScalesSection,
  mockRenderDocumentsSection,
  mockRenderAttachmentsSection,
  mockRenderPersonalNotesSection,
  mockRenderFooter,
} = vi.hoisted(() => ({
  mockRenderCoverPage: vi.fn(),
  mockRenderAnamnesisSection: vi.fn(),
  mockRenderEvolutionsSection: vi.fn(),
  mockRenderHypothesesSection: vi.fn(),
  mockRenderTreatmentPlanSection: vi.fn(),
  mockRenderScalesSection: vi.fn(),
  mockRenderDocumentsSection: vi.fn(),
  mockRenderAttachmentsSection: vi.fn(),
  mockRenderPersonalNotesSection: vi.fn(),
  mockRenderFooter: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock all section renderers so we can spy on whether they are called.
// ---------------------------------------------------------------------------

vi.mock('@/modules/medical-records/lib/exports/sections/cover-page', () => ({
  renderCoverPage: mockRenderCoverPage,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/anamnesis-section', () => ({
  renderAnamnesisSection: mockRenderAnamnesisSection,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/evolutions-section', () => ({
  renderEvolutionsSection: mockRenderEvolutionsSection,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/hypotheses-section', () => ({
  renderHypothesesSection: mockRenderHypothesesSection,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/treatment-plan-section', () => ({
  renderTreatmentPlanSection: mockRenderTreatmentPlanSection,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/scales-section', () => ({
  renderScalesSection: mockRenderScalesSection,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/documents-section', () => ({
  renderDocumentsSection: mockRenderDocumentsSection,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/attachments-section', () => ({
  renderAttachmentsSection: mockRenderAttachmentsSection,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/personal-notes-section', () => ({
  renderPersonalNotesSection: mockRenderPersonalNotesSection,
}));

vi.mock('@/modules/medical-records/lib/exports/sections/footer', () => ({
  renderFooter: mockRenderFooter,
}));

// ---------------------------------------------------------------------------
// Mock pdfkit to avoid pulling in the real native module in unit tests.
// We provide a lightweight mock that emits enough events for collectBuffer.
// ---------------------------------------------------------------------------

vi.mock('pdfkit', async () => {
  const { EventEmitter } = await import('node:events');

  class MockPDFDocument extends EventEmitter {
    page = {
      width: 595,
      height: 842,
      margins: { left: 50, right: 50, top: 50, bottom: 50 },
    };
    y = 50;
    x = 50;

    text() {
      return this;
    }
    font() {
      return this;
    }
    fontSize() {
      return this;
    }
    moveDown() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
    lineWidth() {
      return this;
    }
    stroke() {
      return this;
    }
    addPage() {
      this.page = { ...this.page };
      return this;
    }

    bufferedPageRange() {
      return { start: 0, count: 1 };
    }

    switchToPage() {
      return this;
    }

    end() {
      process.nextTick(() => {
        this.emit('data', Buffer.from('%PDF-1.4 mock'));
        this.emit('end');
      });
    }
  }

  return { default: MockPDFDocument };
});

import type { ExportFilters } from '@/modules/medical-records/lib/exports/export-schemas';
import type { BuildProntuarioPdfInput } from '@/modules/medical-records/lib/exports/pdf-builder';
import { buildProntuarioPdf } from '@/modules/medical-records/lib/exports/pdf-builder';

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

function makeMinimalInput(
  filterOverrides?: Partial<ExportFilters>,
  extras?: Partial<BuildProntuarioPdfInput>,
): BuildProntuarioPdfInput {
  const filters = { ...makeDefaultFilters(), ...filterOverrides };
  return {
    patient: { fullName: 'Joao Silva', birthDate: null, patientType: 'Adulto' },
    psychologist: { name: 'Dra. Ana', crp: '06/111111', email: 'ana@test.com' },
    exportRequestedAt: new Date('2026-05-19T12:00:00.000Z'),
    filters,
    anamnesis: {
      chiefComplaint: 'Queixa principal',
      historyPresentIllness: null,
      familyHistory: null,
      educationalProfessional: null,
      physicalHealth: null,
      priorTherapy: null,
      initialHypothesis: null,
      treatmentPlan: null,
      customSections: null,
    },
    evolutions: [],
    hypotheses: [],
    treatmentPlan: { current: null, versionCount: 0 },
    scales: [],
    documents: [],
    attachments: [],
    personalNotes: null,
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildProntuarioPdf — filter application', () => {
  // ---------------------------------------------------------------------------
  // Section toggle tests
  // ---------------------------------------------------------------------------

  describe('sections.documentos toggle', () => {
    it('calls renderDocumentsSection when sections.documentos is true', async () => {
      mockRenderDocumentsSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, documentos: true } }),
      );

      expect(mockRenderDocumentsSection).toHaveBeenCalled();
    });

    it('does NOT call renderDocumentsSection when sections.documentos is false', async () => {
      mockRenderDocumentsSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, documentos: false } }),
      );

      expect(mockRenderDocumentsSection).not.toHaveBeenCalled();
    });
  });

  describe('sections.evolucoes toggle', () => {
    it('calls renderEvolutionsSection when sections.evolucoes is true', async () => {
      mockRenderEvolutionsSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, evolucoes: true } }),
      );

      expect(mockRenderEvolutionsSection).toHaveBeenCalled();
    });

    it('does NOT call renderEvolutionsSection when sections.evolucoes is false', async () => {
      mockRenderEvolutionsSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, evolucoes: false } }),
      );

      expect(mockRenderEvolutionsSection).not.toHaveBeenCalled();
    });
  });

  describe('sections.hipoteses toggle', () => {
    it('calls renderHypothesesSection when sections.hipoteses is true', async () => {
      mockRenderHypothesesSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, hipoteses: true } }),
      );

      expect(mockRenderHypothesesSection).toHaveBeenCalled();
    });

    it('does NOT call renderHypothesesSection when sections.hipoteses is false', async () => {
      mockRenderHypothesesSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, hipoteses: false } }),
      );

      expect(mockRenderHypothesesSection).not.toHaveBeenCalled();
    });
  });

  describe('sections.escalas toggle', () => {
    it('calls renderScalesSection when sections.escalas is true', async () => {
      mockRenderScalesSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, escalas: true } }),
      );

      expect(mockRenderScalesSection).toHaveBeenCalled();
    });

    it('does NOT call renderScalesSection when sections.escalas is false', async () => {
      mockRenderScalesSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, escalas: false } }),
      );

      expect(mockRenderScalesSection).not.toHaveBeenCalled();
    });
  });

  describe('sections.planoTerapeutico toggle', () => {
    it('calls renderTreatmentPlanSection when sections.planoTerapeutico is true', async () => {
      mockRenderTreatmentPlanSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({
          sections: { ...makeDefaultFilters().sections, planoTerapeutico: true },
        }),
      );

      expect(mockRenderTreatmentPlanSection).toHaveBeenCalled();
    });

    it('does NOT call renderTreatmentPlanSection when sections.planoTerapeutico is false', async () => {
      mockRenderTreatmentPlanSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({
          sections: { ...makeDefaultFilters().sections, planoTerapeutico: false },
        }),
      );

      expect(mockRenderTreatmentPlanSection).not.toHaveBeenCalled();
    });
  });

  describe('sections.anexosIndex toggle', () => {
    it('calls renderAttachmentsSection when sections.anexosIndex is true', async () => {
      mockRenderAttachmentsSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, anexosIndex: true } }),
      );

      expect(mockRenderAttachmentsSection).toHaveBeenCalled();
    });

    it('does NOT call renderAttachmentsSection when sections.anexosIndex is false', async () => {
      mockRenderAttachmentsSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, anexosIndex: false } }),
      );

      expect(mockRenderAttachmentsSection).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Anamnesis — requires both filter toggle AND data
  // ---------------------------------------------------------------------------

  describe('sections.anamnese toggle (requires data)', () => {
    it('calls renderAnamnesisSection when anamnese is true AND anamnesis data exists', async () => {
      mockRenderAnamnesisSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput(
          { sections: { ...makeDefaultFilters().sections, anamnese: true } },
          {
            anamnesis: {
              chiefComplaint: 'Queixa principal',
              historyPresentIllness: null,
              familyHistory: null,
              educationalProfessional: null,
              physicalHealth: null,
              priorTherapy: null,
              initialHypothesis: null,
              treatmentPlan: null,
              customSections: null,
            },
          },
        ),
      );

      expect(mockRenderAnamnesisSection).toHaveBeenCalled();
    });

    it('does NOT call renderAnamnesisSection when anamnese is true but anamnesis data is null', async () => {
      mockRenderAnamnesisSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput(
          { sections: { ...makeDefaultFilters().sections, anamnese: true } },
          { anamnesis: null },
        ),
      );

      expect(mockRenderAnamnesisSection).not.toHaveBeenCalled();
    });

    it('does NOT call renderAnamnesisSection when anamnese is false', async () => {
      mockRenderAnamnesisSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ sections: { ...makeDefaultFilters().sections, anamnese: false } }),
      );

      expect(mockRenderAnamnesisSection).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Personal notes — gated by personalNotes being non-null
  // (the caller sets personalNotes=null when includePersonalNotes=false)
  // ---------------------------------------------------------------------------

  describe('personal notes inclusion', () => {
    it('calls renderPersonalNotesSection when personalNotes is non-null', async () => {
      mockRenderPersonalNotesSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput(
          { includePersonalNotes: true },
          {
            personalNotes: [
              { content: 'Nota privada', updatedAt: new Date('2026-01-01T00:00:00.000Z') },
            ],
          },
        ),
      );

      expect(mockRenderPersonalNotesSection).toHaveBeenCalled();
    });

    it('does NOT call renderPersonalNotesSection when personalNotes is null', async () => {
      mockRenderPersonalNotesSection.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({ includePersonalNotes: false }, { personalNotes: null }),
      );

      expect(mockRenderPersonalNotesSection).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Cover page is always called
  // ---------------------------------------------------------------------------

  describe('cover page', () => {
    it('always calls renderCoverPage regardless of filter settings', async () => {
      mockRenderCoverPage.mockClear();

      await buildProntuarioPdf(
        makeMinimalInput({
          sections: {
            anamnese: false,
            evolucoes: false,
            hipoteses: false,
            planoTerapeutico: false,
            escalas: false,
            documentos: false,
            anexosIndex: false,
          },
        }),
      );

      expect(mockRenderCoverPage).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Footer is always rendered
  // ---------------------------------------------------------------------------

  describe('footer', () => {
    it('always calls renderFooter', async () => {
      mockRenderFooter.mockClear();

      await buildProntuarioPdf(makeMinimalInput());

      expect(mockRenderFooter).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Output is a Buffer
  // ---------------------------------------------------------------------------

  describe('output', () => {
    it('returns a Buffer', async () => {
      const result = await buildProntuarioPdf(makeMinimalInput());
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });
});
