import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Hero } from '@/modules/marketing/components/home/hero';
import { HERO } from '@/modules/marketing/lib/home-content';

/*
 * Hero (Server Component, presentational) — homepage above-the-fold section.
 *
 * Covers the spec contracts exercisable in jsdom:
 *   - the `brand/50`-on-`brand/700` badge text;
 *   - the headline rendered as the section's <h1>, in both the desktop
 *     (`Display/xl`) and condensed mobile (`Display/md`) variants, with the
 *     mobile variant marked `aria-hidden`;
 *   - the subheadline naming every MVP feature + CFP + LGPD (desktop + mobile);
 *   - the primary CTA → `/signup`, with UTM params preserved from the URL;
 *   - the secondary CTA → `#funcionalidades`;
 *   - the reassurance microcopy (desktop + condensed mobile);
 *   - the single-centered-column layout: the carousel sits BELOW the copy block,
 *     not beside it (no two-column / `lg:flex-row` arrangement).
 *
 * The primary CTA is the `SignupCta` client leaf: it renders a stable `/signup`
 * href on first paint and folds in allowlisted `utm_*` params (read from
 * `window.location.search`) after hydration. We assert both the SSR target and
 * the post-hydration UTM-preserved href.
 *
 * Note: jsdom does not evaluate Tailwind breakpoints, so BOTH the desktop and
 * mobile copy variants are present in the DOM. We therefore assert against the
 * specific variant string (`.desktop` / `.mobile`) rather than a shared value.
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

  it('renders both headline variants inside the section heading (level 1)', () => {
    render(<Hero />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(HERO.headline.desktop);
    expect(heading).toHaveTextContent(HERO.headline.mobile ?? '');
  });

  it('marks the condensed mobile headline variant aria-hidden', () => {
    render(<Hero />);
    // The desktop variant is the canonical string for assistive tech; the
    // condensed mobile one is the hidden variant and must be aria-hidden.
    const mobileHeadline = screen.getByText(HERO.headline.mobile ?? '');
    expect(mobileHeadline).toHaveAttribute('aria-hidden', 'true');

    const desktopHeadline = screen.getByText(HERO.headline.desktop);
    expect(desktopHeadline).not.toHaveAttribute('aria-hidden');
  });

  it('names every MVP feature in the desktop subheadline', () => {
    render(<Hero />);

    const subhead = screen.getByText(HERO.subheadline.desktop);
    expect(subhead).toBeInTheDocument();

    for (const feature of [
      /agenda/i,
      /prontu[áa]rio/i,
      /videochamada/i,
      /lembretes autom[áa]ticos no whatsapp/i,
      /transcreve a sess[ãa]o e escreve a evolu/i,
    ]) {
      expect(subhead).toHaveTextContent(feature);
    }
  });

  it('renders the condensed mobile subheadline marked aria-hidden', () => {
    render(<Hero />);
    const mobileSubhead = screen.getByText(HERO.subheadline.mobile ?? '');
    expect(mobileSubhead).toBeInTheDocument();
    expect(mobileSubhead).toHaveAttribute('aria-hidden', 'true');
  });

  it('states CFP and LGPD compliance in both subheadline variants', () => {
    render(<Hero />);

    for (const subhead of [
      screen.getByText(HERO.subheadline.desktop),
      screen.getByText(HERO.subheadline.mobile ?? ''),
    ]) {
      expect(subhead).toHaveTextContent(/CFP/);
      expect(subhead).toHaveTextContent(/LGPD/);
    }
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
  it('renders both reassurance microcopy variants, mobile marked aria-hidden', () => {
    render(<Hero />);
    expect(screen.getByText(HERO.microcopy.desktop)).toBeInTheDocument();
    const mobileMicrocopy = screen.getByText(HERO.microcopy.mobile ?? '');
    expect(mobileMicrocopy).toBeInTheDocument();
    expect(mobileMicrocopy).toHaveAttribute('aria-hidden', 'true');
  });

  it('embeds the screenshot carousel region', () => {
    render(<Hero />);

    const carousel = screen.getByRole('region', { name: /telas do sistema/i });
    expect(carousel).toBeInTheDocument();
    // The first hero slide is the LCP candidate and is visible at first paint.
    expect(within(carousel).getAllByRole('img').length).toBeGreaterThan(0);
  });
});

describe('Hero — single centered column layout', () => {
  it('places the carousel BELOW the copy block, not beside it', () => {
    const { container } = render(<Hero />);

    const heading = screen.getByRole('heading', { level: 1 });
    const carousel = screen.getByRole('region', { name: /telas do sistema/i });

    // The copy block (ancestor of the headline) precedes the carousel block in
    // DOM order — the carousel sits below the copy, not beside it.
    const position = heading.compareDocumentPosition(carousel);
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    // No two-column arrangement: nothing in the hero uses the old `lg:flex-row`
    // two-column layout class.
    expect(container.querySelector('.lg\\:flex-row')).toBeNull();
  });
});
