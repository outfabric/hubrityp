import { describe, expect, it } from 'vitest';

import { TOUR_STEPS } from '@/modules/onboarding/lib/tour-steps';

// ---------------------------------------------------------------------------
// TOUR_STEPS — the pure five-step tour catalog.
//
// Proves the section-3 tour contract WITHOUT a browser:
//   * exactly five steps, in the PRD-mandated order
//   * each anchor is a `data-tour-*` selector (decoupled from styling/test ids)
//   * the copy matches PRD 11 §5.5 intent
//   * NO post-MVP strings leak into the copy (WhatsApp / Receita Saúde / PIX /
//     cobrança / recibo) — those surfaces are frozen/absent, so the tour must
//     never point at them.
// ---------------------------------------------------------------------------

/** Post-MVP terms the tour copy must never contain (case-insensitive). */
const FORBIDDEN_TERMS = ['WhatsApp', 'Receita Saúde', 'PIX', 'cobrança', 'recibo'];

describe('TOUR_STEPS catalog', () => {
  it('has exactly five steps', () => {
    expect(TOUR_STEPS).toHaveLength(5);
  });

  it('keeps the PRD-mandated step order via stable data-tour anchors', () => {
    expect(TOUR_STEPS.map((step) => step.anchor)).toEqual([
      '[data-tour-anchor="sidebar-nav"]',
      '[data-tour-anchor="secao-hoje"]',
      '[data-tour-anchor="secao-pendencias"]',
      '[data-tour-anchor="novo-paciente"]',
      '[data-tour-anchor="nova-sessao"]',
    ]);
  });

  it('anchors every step with a data-tour-* attribute selector', () => {
    for (const step of TOUR_STEPS) {
      expect(step.anchor).toMatch(/^\[data-tour-[a-z-]+="[a-z-]+"\]$/);
    }
  });

  it('matches the PRD 11 §5.5 tooltip copy', () => {
    expect(TOUR_STEPS.map((step) => step.description)).toEqual([
      'Este é seu menu principal. Aqui você navega entre as áreas do consultório.',
      'Aqui você vê as sessões do dia e o que precisa da sua atenção agora.',
      'Itens que precisam de ação ficam aqui — evoluções pendentes, confirmações aguardando resposta.',
      'Use este atalho para cadastrar um novo paciente rapidamente.',
      'Agende uma sessão por aqui. É o ponto de partida para a rotina clínica.',
    ]);
  });

  it('gives every step a non-empty title and description', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains no post-MVP surfaces in any title or description', () => {
    const corpus = TOUR_STEPS.map((step) => `${step.title} ${step.description}`)
      .join(' ')
      .toLowerCase();

    for (const term of FORBIDDEN_TERMS) {
      expect(corpus).not.toContain(term.toLowerCase());
    }
  });
});
