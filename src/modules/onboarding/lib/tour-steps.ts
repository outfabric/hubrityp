/**
 * The five-step guided product tour, as a pure, framework-agnostic array.
 *
 * Each entry pairs a stable `data-tour-*` anchor selector (the surfaces the tour
 * highlights) with the PRD 11 §5.5 tooltip copy. Keeping this a plain constant
 * (no Driver.js import, no DOM access) lets the unit suite assert the contract
 * — exactly five steps, correct order, MVP-only copy — without a browser, and
 * lets the client tour leaf consume it through the module barrel.
 *
 * IMPORTANT: the copy must stay MVP-scoped. It must NOT mention post-MVP
 * surfaces — WhatsApp, Receita Saúde, PIX, cobrança, recibo — because those
 * features are frozen/absent in the shipped product and the tour would point at
 * controls that do not exist. The unit test enforces this.
 */

/** A single tour step: the anchor it highlights plus its tooltip copy. */
export interface TourStep {
  /**
   * The `data-tour-*` attribute selector of the element this step highlights.
   * Anchors are stable contracts placed on dashboard surfaces; selecting by a
   * dedicated `data-tour-*` attribute (rather than a CSS class or test id) keeps
   * the tour decoupled from styling and from the test harness.
   */
  readonly anchor: string;
  /** Short pt-BR tooltip title. */
  readonly title: string;
  /** pt-BR tooltip body — verbatim PRD 11 §5.5 copy. */
  readonly description: string;
}

/**
 * The tour, in presentation order. The order is part of the contract (PRD 11
 * §5.5) and is asserted by the unit suite:
 *   1. sidebar navigation
 *   2. Seção Hoje
 *   3. Seção Pendências
 *   4. "+ Novo paciente"
 *   5. "+ Nova sessão"
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    anchor: '[data-tour-anchor="sidebar-nav"]',
    title: 'Menu principal',
    description: 'Este é seu menu principal. Aqui você navega entre as áreas do consultório.',
  },
  {
    anchor: '[data-tour-anchor="secao-hoje"]',
    title: 'Hoje',
    description: 'Aqui você vê as sessões do dia e o que precisa da sua atenção agora.',
  },
  {
    anchor: '[data-tour-anchor="secao-pendencias"]',
    title: 'Pendências',
    description:
      'Itens que precisam de ação ficam aqui — evoluções pendentes, confirmações aguardando resposta.',
  },
  {
    anchor: '[data-tour-anchor="novo-paciente"]',
    title: 'Novo paciente',
    description: 'Use este atalho para cadastrar um novo paciente rapidamente.',
  },
  {
    anchor: '[data-tour-anchor="nova-sessao"]',
    title: 'Nova sessão',
    description: 'Agende uma sessão por aqui. É o ponto de partida para a rotina clínica.',
  },
] as const;
