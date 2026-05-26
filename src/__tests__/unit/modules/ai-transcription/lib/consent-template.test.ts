import { describe, expect, it } from 'vitest';

import { AI_CONSENT_TEMPLATE_V1, type AiConsentTemplate } from '@/modules/ai-transcription';

// ---------------------------------------------------------------------------
// Expected section headings (in order) per the spec
// ---------------------------------------------------------------------------

const EXPECTED_HEADINGS = [
  'Identificação',
  'Finalidade',
  'Bases legais (LGPD)',
  'Operação de tratamento',
  'Retenção',
  'Direitos do titular',
  'Revogação',
  'Riscos',
] as const;

describe('AI_CONSENT_TEMPLATE_V1', () => {
  // ---- (a) All 8 section headings exist -----------------------------------

  it('(a) contains exactly the 8 required section headings in order', () => {
    const headings = AI_CONSENT_TEMPLATE_V1.sections.map((s) => s.heading);
    expect(headings).toEqual([...EXPECTED_HEADINGS]);
  });

  // ---- (b) "Bases legais" mentions LGPD art. 7 and art. 11 ---------------

  it('(b) "Bases legais" body mentions LGPD art. 7 and art. 11', () => {
    const section = findSection(AI_CONSENT_TEMPLATE_V1, 'Bases legais (LGPD)');
    expect(section.body).toMatch(/art\.\s*7/i);
    expect(section.body).toMatch(/art\.\s*11/i);
  });

  // ---- (c) "Retenção" mentions 24h ----------------------------------------

  it('(c) "Retenção" body mentions 24 hours', () => {
    const section = findSection(AI_CONSENT_TEMPLATE_V1, 'Retenção');
    expect(section.body).toMatch(/24\s*h/i);
  });

  // ---- (d) "Revogação" mentions efeito imediato ----------------------------

  it('(d) "Revogação" body mentions efeito imediato', () => {
    const section = findSection(AI_CONSENT_TEMPLATE_V1, 'Revogação');
    expect(section.body).toMatch(/efeito imediato/i);
  });

  // ---- (e) Snapshot test pins the exact text --------------------------------

  it('(e) snapshot of the full template structure matches (deliberate update required on change)', () => {
    expect(AI_CONSENT_TEMPLATE_V1).toMatchSnapshot();
  });

  // ---- Structural guards ----------------------------------------------------

  it('has version = 1', () => {
    expect(AI_CONSENT_TEMPLATE_V1.version).toBe(1);
  });

  it('has a non-empty title', () => {
    expect(AI_CONSENT_TEMPLATE_V1.title.length).toBeGreaterThan(0);
  });

  it('every section has a non-empty heading and body', () => {
    for (const section of AI_CONSENT_TEMPLATE_V1.sections) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
    }
  });

  it('identification section contains placeholders for psychologist and patient', () => {
    const section = findSection(AI_CONSENT_TEMPLATE_V1, 'Identificação');
    expect(section.body).toContain('{{psychologistName}}');
    expect(section.body).toContain('{{psychologistCrp}}');
    expect(section.body).toContain('{{patientName}}');
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function findSection(template: AiConsentTemplate, heading: string) {
  const section = template.sections.find((s) => s.heading === heading);
  if (!section) {
    throw new Error(`Section "${heading}" not found in template`);
  }
  return section;
}
