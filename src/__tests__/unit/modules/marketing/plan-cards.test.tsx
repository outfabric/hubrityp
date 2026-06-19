import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanCards } from '@/modules/marketing/components/pricing/plan-cards';
import { FEATURE_LABELS, planSlugSchema, PLANS } from '@/modules/marketing/lib/plans';
import type * as PlansModule from '@/modules/marketing/lib/plans';
import { PRICING_PAGE } from '@/modules/marketing/lib/pricing-content';

/*
 * Plan cards (the `/precos` pricing cards) — config-driven, monthly only.
 *
 * Behavioral contracts (RF-14.26 / RN-14.05, design decisions D3 & D7):
 *   - Renders exactly one card per plan in the central `PLANS` config; names,
 *     prices (derived from `priceCents`) and the badge all come FROM the config,
 *     never from hardcoded literals — so the test derives its expectations from
 *     `PLANS` and the two cannot drift apart.
 *   - The Avançado plan carries the "Popular" badge (the config flags it as the
 *     popular plan); Essencial does not.
 *   - Each card's CTA links to `/signup?plano=<slug>` with an allowlisted slug.
 *   - Billing is monthly only — there is NO annual/monthly toggle anywhere.
 *   - When the config resolves to zero plans, the cards are hidden and the
 *     empty-plans fallback ("Entre em contato…" + support email) is shown.
 */

/** Mirror of the component's display-layer formatter (D7: cents → BRL). */
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
});

describe('PlanCards — config-driven cards', () => {
  it('renders exactly one card per plan in the central PLANS config', () => {
    render(<PlanCards />);

    // One <li> per plan card (the feature checklists are nested <ul>s, but the
    // role query scoped to the plan grid counts only the top-level cards via
    // their headings).
    for (const plan of PLANS) {
      expect(screen.getByRole('heading', { name: plan.name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(PLANS.length);
  });

  it('renders each plan name and monthly price derived from the config', () => {
    render(<PlanCards />);

    for (const plan of PLANS) {
      expect(screen.getByRole('heading', { name: plan.name })).toBeInTheDocument();

      // Price derived from `priceCents`. Testing Library collapses the NBSP that
      // `Intl.NumberFormat` emits, so normalize before matching.
      const expectedPrice = BRL.format(plan.priceCents / 100).replace(/ /g, ' ');
      expect(screen.getByText(expectedPrice)).toBeInTheDocument();
    }
  });

  it('confirms the config holds the expected MVP prices and slugs', () => {
    // Guards the prices/slugs at the source so a config change is caught here.
    const bySlug = new Map(PLANS.map((plan) => [plan.slug, plan]));

    expect(bySlug.get(planSlugSchema.parse('essencial'))?.priceCents).toBe(6000);
    expect(bySlug.get(planSlugSchema.parse('avancado'))?.priceCents).toBe(9000);
    expect(PLANS.map((plan) => plan.slug)).toEqual(['essencial', 'avancado']);
  });

  it('shows the "Popular" badge on the Avançado plan and not on Essencial', () => {
    render(<PlanCards />);

    const avancado = PLANS.find((plan) => plan.slug === 'avancado');
    const essencial = PLANS.find((plan) => plan.slug === 'essencial');
    expect(avancado?.badge).toBeDefined();
    // The badge text is the config value and reads as the "Popular" tag.
    expect(avancado!.badge).toMatch(/Popular/i);

    const avancadoCard = screen.getByRole('heading', { name: avancado!.name }).closest('li');
    expect(avancadoCard).not.toBeNull();
    expect(within(avancadoCard!).getByText(avancado!.badge!)).toBeInTheDocument();

    const essencialCard = screen.getByRole('heading', { name: essencial!.name }).closest('li');
    expect(essencialCard).not.toBeNull();
    expect(within(essencialCard!).queryByText(/Popular/i)).not.toBeInTheDocument();
  });

  it('renders the full checkmarked feature list of each plan from the config', () => {
    render(<PlanCards />);

    for (const plan of PLANS) {
      const card = screen.getByRole('heading', { name: plan.name }).closest('li');
      expect(card).not.toBeNull();

      const included = plan.features.filter((feature) => feature.included);
      for (const feature of included) {
        expect(within(card!).getByText(FEATURE_LABELS[feature.key])).toBeInTheDocument();
      }
      // Excluded features must NOT appear in this card's checklist.
      const excluded = plan.features.filter((feature) => !feature.included);
      for (const feature of excluded) {
        expect(within(card!).queryByText(FEATURE_LABELS[feature.key])).not.toBeInTheDocument();
      }
    }
  });

  it('links each CTA to /signup?plano=<allowlisted-slug> with the verbatim label', () => {
    render(<PlanCards />);

    const ctas = screen.getAllByRole('link', { name: PRICING_PAGE.ctaLabel });
    expect(ctas).toHaveLength(PLANS.length);

    const hrefs = ctas.map((cta) => cta.getAttribute('href'));
    for (const plan of PLANS) {
      // SSR / first render: stable `/signup?plano=<slug>` before UTM folds in.
      expect(hrefs).toContain(`/signup?plano=${plan.slug}`);
    }

    // The slug segment is always an allowlisted config slug — never free-form.
    const slugPattern = new RegExp(`^/signup\\?plano=(${PLANS.map((p) => p.slug).join('|')})$`);
    for (const href of hrefs) {
      expect(href).toMatch(slugPattern);
    }
  });

  it('shows monthly pricing only — there is no annual/monthly toggle', () => {
    render(<PlanCards />);

    // No billing-period toggle control of any kind.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/anual/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/por ano|\/ano/i)).not.toBeInTheDocument();

    // Every price is framed as monthly.
    expect(screen.getAllByText('/mês')).toHaveLength(PLANS.length);
  });
});

describe('PlanCards — empty-plans fallback', () => {
  it('hides the cards and shows the contact fallback when the config has no plans', async () => {
    // Override the config to resolve to zero plans for this test only, then
    // import a fresh copy of the component so it reads the mocked module.
    vi.resetModules();
    vi.doMock('@/modules/marketing/lib/plans', async () => {
      const actual = await vi.importActual<typeof PlansModule>('@/modules/marketing/lib/plans');
      return { ...actual, PLANS: [] };
    });

    const { PlanCards: EmptyPlanCards } =
      await import('@/modules/marketing/components/pricing/plan-cards');

    render(<EmptyPlanCards />);

    // No plan cards / CTAs.
    expect(screen.queryByRole('link', { name: PRICING_PAGE.ctaLabel })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();

    // The contact fallback message + support email (a mailto link).
    expect(screen.getByText('Entre em contato para saber mais')).toBeInTheDocument();
    const supportLink = screen.getByRole('link', { name: 'hubrity.platform@gmail.com' });
    expect(supportLink).toHaveAttribute('href', 'mailto:hubrity.platform@gmail.com');

    vi.doUnmock('@/modules/marketing/lib/plans');
    vi.resetModules();
  });
});
