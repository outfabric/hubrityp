import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CtaFinal } from '@/modules/marketing/components/home/cta-final';
import { PrecosResumo } from '@/modules/marketing/components/home/precos-resumo';
import { FINAL_CTA, PRICING_SUMMARY } from '@/modules/marketing/lib/home-content';
import { PLANS } from '@/modules/marketing/lib/plans';

/*
 * Preços resumo + CTA final (presentational sections) — the pricing teaser and
 * closing call-to-action of the homepage.
 *
 * Behavioral contracts:
 *   - PrecosResumo renders exactly the plans in the central `PLANS` config:
 *     names, prices (derived from `priceCents`), and the "Mais popular" badge
 *     all come FROM the config, not from hardcoded literals. The test derives
 *     its expectations from `PLANS`, so changing the config changes both the
 *     render and the expectation together — there is no duplicated source of
 *     truth to drift.
 *   - CtaFinal sits on a SOLID `brand/700` inverse surface (no gradient / glow /
 *     blur) and its CTA targets `/signup`.
 */

/** Mirror of the component's display-layer formatter (D7: cents → BRL). */
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
});

describe('PrecosResumo — prices come from the central config', () => {
  it('renders one card per plan in the central PLANS config', () => {
    render(<PrecosResumo />);

    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(PLANS.length);
  });

  it('renders each plan name and price derived from the config (not hardcoded)', () => {
    render(<PrecosResumo />);

    for (const plan of PLANS) {
      // The plan NAME comes from config.
      expect(screen.getByRole('heading', { name: plan.name })).toBeInTheDocument();

      // The PRICE is derived from `priceCents` — changing the config value
      // would change this expectation and the render in lockstep. Testing
      // Library collapses the NBSP that `Intl.NumberFormat` emits between the
      // currency symbol and the amount, so normalize it here before matching.
      const expectedPrice = BRL.format(plan.priceCents / 100).replace(/\u00A0/g, ' ');
      expect(screen.getByText(expectedPrice)).toBeInTheDocument();
    }
  });

  it('renders the "Mais popular" badge exactly for the configured plan', () => {
    render(<PrecosResumo />);

    const badgedPlans = PLANS.filter((plan) => plan.badge);
    // Sanity: the config currently flags one plan as popular.
    expect(badgedPlans.length).toBeGreaterThan(0);

    for (const plan of badgedPlans) {
      const card = screen.getByRole('heading', { name: plan.name }).closest('li');
      expect(card).not.toBeNull();
      expect(within(card!).getByText(plan.badge!)).toBeInTheDocument();
    }

    // Plans without a badge must not surface one.
    for (const plan of PLANS.filter((p) => !p.badge)) {
      const card = screen.getByRole('heading', { name: plan.name }).closest('li');
      expect(card).not.toBeNull();
      expect(within(card!).queryByText('Mais popular')).not.toBeInTheDocument();
    }
  });

  it('links to the full /precos page from the content layer', () => {
    render(<PrecosResumo />);

    const link = screen.getByRole('link', { name: PRICING_SUMMARY.fullPlansLinkLabel });
    expect(link).toHaveAttribute('href', '/precos');
    expect(PRICING_SUMMARY.fullPlansHref).toBe('/precos');
  });
});

describe('CtaFinal — solid surface + /signup target', () => {
  it('renders on a solid brand/700 inverse surface with no gradient or blur', () => {
    const { container } = render(<CtaFinal />);
    const section = container.querySelector('section');
    expect(section).not.toBeNull();

    const className = section!.className;
    expect(className).toContain('bg-brand-700');
    expect(className).toContain('text-text-inverse');
    // DS prohibition: no gradient / glow / blur treatments on this surface.
    expect(className).not.toMatch(/gradient/);
    expect(className).not.toMatch(/\bblur\b/);
  });

  it('renders the closing title from the content layer', () => {
    render(<CtaFinal />);

    expect(screen.getByRole('heading', { name: FINAL_CTA.title })).toBeInTheDocument();
  });

  it('renders a CTA that links to /signup', () => {
    render(<CtaFinal />);

    const cta = screen.getByRole('link', { name: FINAL_CTA.cta.label });
    // SSR / first render: SignupCta emits a stable `/signup` href before
    // hydration folds in any UTM params.
    expect(cta).toHaveAttribute('href', '/signup');
    expect(FINAL_CTA.cta.href).toBe('/signup');
  });
});
