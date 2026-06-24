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
import { PLAN_SLUGS } from '@/modules/marketing/lib/plans';

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
    HERO.headline.desktop,
    HERO.headline.mobile ?? '',
    HERO.subheadline.desktop,
    HERO.subheadline.mobile ?? '',
    HERO.primaryCta.label,
    HERO.secondaryCta.label,
    HERO.microcopy.desktop,
    HERO.microcopy.mobile ?? '',
    ...SOCIAL_PROOF_STATS.flatMap((s) => [s.figure, s.caption]),
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
    PRICING_SUMMARY.microcopy.desktop,
    PRICING_SUMMARY.microcopy.mobile ?? '',
    PRICING_SUMMARY.fullPlansLinkLabel,
    ...[PRICING_SUMMARY.cards.essencial, PRICING_SUMMARY.cards.avancado].flatMap((card) => [
      card.tagline.desktop,
      'mobile' in card.tagline ? card.tagline.mobile : '',
      ...card.bullets.flatMap((b) => [b.desktop, 'mobile' in b ? b.mobile : '']),
    ]),
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

describe('home-content — hero copy (Figma 108:2 / 133:14)', () => {
  it('carries the desktop headline/subheadline/microcopy strings', () => {
    expect(HERO.headline.desktop).toBe('De 10 ferramentas espalhadas a um só sistema clínico.');
    expect(HERO.subheadline.desktop).toBe(
      'Agenda, prontuário, videochamada, lembretes automáticos no WhatsApp e uma IA que transcreve a sessão e escreve a evolução — tudo em conformidade com o CFP e a LGPD.',
    );
    expect(HERO.microcopy.desktop).toBe('Sem cartão de crédito. Cancele quando quiser.');
  });

  it('condenses the headline/subheadline/microcopy on mobile', () => {
    expect(HERO.headline.mobile).toBe('De 10 ferramentas a um só sistema clínico.');
    expect(HERO.subheadline.mobile).toBe(
      'Agenda, prontuário, vídeo, WhatsApp automático e uma IA que escreve a evolução — em conformidade com o CFP e a LGPD.',
    );
    expect(HERO.microcopy.mobile).toBe('Sem cartão. Cancele quando quiser.');
  });

  it('keeps the badge and CTA labels constant across breakpoints', () => {
    expect(HERO.badge).toBe('Feito para psicólogos autônomos');
    expect(HERO.primaryCta.label).toBe('Começar grátis — 14 dias');
    expect(HERO.secondaryCta.label).toBe('Ver funcionalidades');
  });
});

describe('home-content — pricing summary cards (design D4)', () => {
  it('has a curated card for every plan slug and no extra ones', () => {
    expect(Object.keys(PRICING_SUMMARY.cards).sort()).toEqual([...PLAN_SLUGS].sort());
  });

  it('carries the spec taglines (desktop + condensed mobile where Figma differs)', () => {
    expect(PRICING_SUMMARY.cards.essencial.tagline.desktop).toBe(
      'Para começar com o essencial do consultório.',
    );
    expect(PRICING_SUMMARY.cards.essencial.tagline.mobile).toBe('O núcleo clínico do consultório.');
    // Avançado tagline is short enough that Figma does not condense it: the
    // `mobile` override is absent (the desktop string renders at every width).
    expect(PRICING_SUMMARY.cards.avancado.tagline.desktop).toBe(
      'Tudo do Essencial + automação e IA.',
    );
    expect('mobile' in PRICING_SUMMARY.cards.avancado.tagline).toBe(false);
  });

  it('lists the spec summary bullets in order with the condensed mobile overrides', () => {
    expect(PRICING_SUMMARY.cards.essencial.bullets.map((b) => b.desktop)).toEqual([
      'Agenda, pacientes e prontuário',
      'Telepsicologia integrada',
      'Documentos CFP e escalas clínicas',
      'Dashboard operacional',
    ]);
    expect(PRICING_SUMMARY.cards.essencial.bullets[2]?.mobile).toBe('Documentos CFP e escalas');

    expect(PRICING_SUMMARY.cards.avancado.bullets.map((b) => b.desktop)).toEqual([
      'Tudo do Essencial',
      'Lembretes automáticos no WhatsApp',
      'Transcrição e nota com IA',
    ]);
    expect(PRICING_SUMMARY.cards.avancado.bullets[1]?.mobile).toBe('Lembretes no WhatsApp');
  });

  it('condenses the reassurance microcopy on mobile', () => {
    expect(PRICING_SUMMARY.microcopy.desktop).toBe(
      '14 dias grátis para testar tudo. Sem cartão de crédito. Cancele quando quiser.',
    );
    expect(PRICING_SUMMARY.microcopy.mobile).toBe(
      '14 dias grátis. Sem cartão. Cancele quando quiser.',
    );
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
