import { describe, expect, it } from 'vitest';

import {
  HERO,
  SOCIAL_PROOF_STATS,
  PROBLEM,
  SOLUTION_STEPS,
  SOLUTION_CLOSER,
  FEATURE_CARDS,
  AI_HIGHLIGHT,
  TRUST,
  PRICING_SUMMARY,
  FAQ_ENTRIES,
  FINAL_CTA,
  SCREENSHOTS,
  HERO_CAROUSEL_SLIDES,
  type ScreenshotKey,
} from '@/modules/marketing/lib/home-content';

// The literal regulatory codes/years/standards the confiança section MUST contain
// verbatim. A typo here is a compliance bug, so they are asserted as exact strings.
const REQUIRED_REGULATORY_CODES = [
  '001/2009',
  '06/2019',
  '09/2024',
  '13/2022',
  'AES-256',
  'TLS 1.3',
  '13.787/2018',
  'CRP ativo',
] as const;

// Post-MVP capabilities that MUST NOT be surfaced as available anywhere in the
// homepage copy. Matching is case-insensitive against the concatenated content.
const POST_MVP_FORBIDDEN = [
  'pix',
  'cobrança',
  'cobranca',
  'receita saúde',
  'receita saude',
  'reembolso',
  'recibo',
] as const;

/** Flattens every user-facing string in the content module into one haystack. */
function allHomeCopy(): string {
  const parts: string[] = [
    HERO.badge,
    HERO.headline,
    HERO.subheadline,
    HERO.primaryCta.label,
    HERO.secondaryCta.label,
    HERO.microcopy,
    ...SOCIAL_PROOF_STATS.map((s) => s.text),
    PROBLEM.title,
    ...PROBLEM.items,
    PROBLEM.closer,
    ...SOLUTION_STEPS.flatMap((s) => [s.title, s.description]),
    SOLUTION_CLOSER,
    ...FEATURE_CARDS.flatMap((c) => [c.title, c.description]),
    AI_HIGHLIGHT.title,
    AI_HIGHLIGHT.subtitle,
    AI_HIGHLIGHT.beforeLabel,
    AI_HIGHLIGHT.afterLabel,
    ...AI_HIGHLIGHT.trustItems,
    AI_HIGHLIGHT.cta.label,
    TRUST.title,
    ...TRUST.guarantees.map((g) => g.text),
    TRUST.closer,
    PRICING_SUMMARY.title,
    PRICING_SUMMARY.microcopy,
    PRICING_SUMMARY.fullPlansLinkLabel,
    ...FAQ_ENTRIES.flatMap((f) => [f.question, f.answer]),
    FINAL_CTA.title,
    FINAL_CTA.cta.label,
    FINAL_CTA.microcopy,
  ];
  return parts.join(' \n ');
}

describe('home-content — list cardinalities', () => {
  it('has exactly 5 problema mirror items', () => {
    expect(PROBLEM.items).toHaveLength(5);
  });

  it('has exactly 6 solution steps, ordered 1..6', () => {
    expect(SOLUTION_STEPS).toHaveLength(6);
    expect(SOLUTION_STEPS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('has exactly 7 feature cards', () => {
    expect(FEATURE_CARDS).toHaveLength(7);
  });

  it('has exactly 8 regulatory guarantees', () => {
    expect(TRUST.guarantees).toHaveLength(8);
  });

  it('has exactly 5 FAQ entries', () => {
    expect(FAQ_ENTRIES).toHaveLength(5);
  });

  it('exposes 2 prova-social stats and 4 AI trust items', () => {
    expect(SOCIAL_PROOF_STATS).toHaveLength(2);
    expect(AI_HIGHLIGHT.trustItems).toHaveLength(4);
  });
});

describe('home-content — feature cards', () => {
  it('lists the 7 MVP feature titles in order', () => {
    expect(FEATURE_CARDS.map((c) => c.title)).toEqual([
      'Agenda',
      'Pacientes',
      'WhatsApp Automático',
      'Prontuário',
      'Telepsicologia',
      'IA Clínica',
      'Dashboard Operacional',
    ]);
  });

  it('marks only the Dashboard card as wide (double-width)', () => {
    const wide = FEATURE_CARDS.filter((c) => c.wide);
    expect(wide).toHaveLength(1);
    expect(wide[0]?.id).toBe('dashboard');
  });

  it('references only known screenshot keys', () => {
    for (const card of FEATURE_CARDS) {
      if (card.screenshot) {
        expect(SCREENSHOTS[card.screenshot]).toBeDefined();
      }
    }
  });
});

describe('home-content — regulatory guarantees (exact codes)', () => {
  it('contains every required literal regulatory code/year', () => {
    const trustText = TRUST.guarantees.map((g) => g.text).join(' ');
    for (const code of REQUIRED_REGULATORY_CODES) {
      expect(trustText).toContain(code);
    }
  });
});

describe('home-content — CTA targets', () => {
  it('hero primary CTA and AI/final CTAs target /signup', () => {
    expect(HERO.primaryCta.href).toBe('/signup');
    expect(AI_HIGHLIGHT.cta.href).toBe('/signup');
    expect(FINAL_CTA.cta.href).toBe('/signup');
  });

  it('hero secondary CTA anchors to #funcionalidades', () => {
    expect(HERO.secondaryCta.href).toBe('#funcionalidades');
  });

  it('pricing summary links to /precos', () => {
    expect(PRICING_SUMMARY.fullPlansHref).toBe('/precos');
  });
});

describe('home-content — hero carousel', () => {
  it('shows the 5 ordered hero screenshots with captions', () => {
    expect(HERO_CAROUSEL_SLIDES).toHaveLength(5);
    expect(HERO_CAROUSEL_SLIDES.map((s) => s.screenshot)).toEqual([
      'hoje-pendencias',
      'agenda',
      'evolucao',
      'pacientes',
      'telepsicologia',
    ]);
    for (const slide of HERO_CAROUSEL_SLIDES) {
      expect(slide.caption.length).toBeGreaterThan(0);
      expect(SCREENSHOTS[slide.screenshot]).toBeDefined();
    }
  });
});

describe('home-content — screenshot assets', () => {
  const KEYS: ScreenshotKey[] = [
    'hoje-pendencias',
    'painel',
    'agenda',
    'pacientes',
    'whatsapp',
    'prontuario',
    'telepsicologia',
    'evolucao',
  ];

  it('declares explicit dimensions, a public src and pt-BR alt for every key', () => {
    for (const key of KEYS) {
      const asset = SCREENSHOTS[key];
      expect(asset.src).toBe(`/screenshots/${key}.webp`);
      expect(asset.width).toBeGreaterThan(0);
      expect(asset.height).toBeGreaterThan(0);
      expect(asset.alt.length).toBeGreaterThan(0);
    }
  });
});

describe('home-content — MVP guard', () => {
  it('does not surface any post-MVP feature as available', () => {
    const haystack = allHomeCopy().toLowerCase();
    for (const forbidden of POST_MVP_FORBIDDEN) {
      expect(haystack).not.toContain(forbidden);
    }
  });
});
