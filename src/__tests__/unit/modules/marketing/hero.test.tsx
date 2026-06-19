import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Hero } from '@/modules/marketing/components/home/hero';
import { HERO } from '@/modules/marketing/lib/home-content';

/*
 * Hero (Server Component, presentational) — homepage above-the-fold section.
 *
 * Covers the spec contracts exercisable in jsdom:
 *   - the `brand/50`-on-`brand/700` badge text;
 *   - the `Display/xl` headline rendered as the section's <h1>;
 *   - the `Lead` subheadline naming every MVP feature + CFP + LGPD;
 *   - the primary CTA → `/signup`, with UTM params preserved from the URL;
 *   - the secondary CTA → `#funcionalidades`;
 *   - the reassurance microcopy.
 *
 * The primary CTA is the `SignupCta` client leaf: it renders a stable `/signup`
 * href on first paint and folds in allowlisted `utm_*` params (read from
 * `window.location.search`) after hydration. We assert both the SSR target and
 * the post-hydration UTM-preserved href.
 */

function hrefOf(name: RegExp | string): string | null {
  return screen.getByRole('link', { name }).getAttribute('href');
}

afterEach(() => {
  // Reset the URL so UTM state from one test never bleeds into the next.
  window.history.replaceState(null, '', '/');
});

describe('Hero — badge, headline, subheadline', () => {
  it('renders the badge text', () => {
    render(<Hero />);
    expect(screen.getByText(HERO.badge)).toBeInTheDocument();
  });

  it('renders the headline as the section heading (level 1)', () => {
    render(<Hero />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HERO.headline);
  });

  it('names every MVP feature in the subheadline', () => {
    render(<Hero />);

    const subhead = screen.getByText(HERO.subheadline);
    expect(subhead).toBeInTheDocument();

    for (const feature of [
      /agenda/i,
      /prontu[áa]rio/i,
      /videochamada/i,
      /whatsapp automatizado/i,
      /transcreve e escreve a evolu/i,
    ]) {
      expect(subhead).toHaveTextContent(feature);
    }
  });

  it('states CFP and LGPD compliance in the subheadline', () => {
    render(<Hero />);

    const subhead = screen.getByText(HERO.subheadline);
    expect(subhead).toHaveTextContent(/CFP/);
    expect(subhead).toHaveTextContent(/LGPD/);
  });
});

describe('Hero — CTAs', () => {
  it('points the primary CTA at /signup (no UTM on a bare URL)', () => {
    render(<Hero />);
    expect(hrefOf(new RegExp(`^${HERO.primaryCta.label}$`, 'i'))).toBe('/signup');
  });

  it('preserves UTM params on the primary CTA after hydration', async () => {
    window.history.replaceState(null, '', '/?utm_source=newsletter&utm_campaign=launch&evil=x');

    render(<Hero />);

    await waitFor(() => {
      const href = hrefOf(new RegExp(`^${HERO.primaryCta.label}$`, 'i'));
      expect(href).toBe('/signup?utm_source=newsletter&utm_campaign=launch');
    });
  });

  it('points the secondary CTA at the #funcionalidades anchor', () => {
    render(<Hero />);
    expect(hrefOf(new RegExp(`^${HERO.secondaryCta.label}$`, 'i'))).toBe('#funcionalidades');
  });
});

describe('Hero — microcopy & carousel', () => {
  it('renders the reassurance microcopy', () => {
    render(<Hero />);
    expect(screen.getByText(HERO.microcopy)).toBeInTheDocument();
  });

  it('embeds the screenshot carousel region', () => {
    render(<Hero />);

    const carousel = screen.getByRole('region', { name: /telas do sistema/i });
    expect(carousel).toBeInTheDocument();
    // The first hero slide is the LCP candidate and is visible at first paint.
    expect(within(carousel).getAllByRole('img').length).toBeGreaterThan(0);
  });
});
