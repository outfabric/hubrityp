import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DestaqueIa } from '@/modules/marketing/components/home/destaque-ia';
import { AI_HIGHLIGHT } from '@/modules/marketing/lib/home-content';

/*
 * Destaque IA (presentational section) — the AI-highlight band of the homepage.
 *
 * Behavioral contracts:
 *   - the surface is a SOLID `brand/50` band — no gradient / glow / blur (DS rule);
 *   - the quantified title and explanatory subtitle render from the content layer;
 *   - the antes/depois pair shows both labels;
 *   - exactly the 4 trust/safety items render;
 *   - the CTA points at `/signup`.
 */

describe('DestaqueIa — surface', () => {
  it('renders on a solid brand/50 surface with no gradient or blur', () => {
    const { container } = render(<DestaqueIa />);
    const section = container.querySelector('section');
    expect(section).not.toBeNull();

    const className = section!.className;
    expect(className).toContain('bg-brand-50');
    // DS prohibition: no gradient / glow / blur treatments on this surface.
    expect(className).not.toMatch(/gradient/);
    expect(className).not.toMatch(/\bblur\b/);
  });
});

describe('DestaqueIa — copy', () => {
  it('renders the quantified title and subtitle', () => {
    render(<DestaqueIa />);

    expect(screen.getByRole('heading', { name: AI_HIGHLIGHT.title })).toBeInTheDocument();
    expect(screen.getByText(AI_HIGHLIGHT.subtitle)).toBeInTheDocument();
  });

  it('renders both the antes and depois labels', () => {
    render(<DestaqueIa />);

    expect(screen.getByText(AI_HIGHLIGHT.beforeLabel)).toBeInTheDocument();
    expect(screen.getByText(AI_HIGHLIGHT.afterLabel)).toBeInTheDocument();
  });
});

describe('DestaqueIa — trust items', () => {
  it('renders exactly the 4 trust/safety items', () => {
    render(<DestaqueIa />);

    expect(AI_HIGHLIGHT.trustItems).toHaveLength(4);
    for (const item of AI_HIGHLIGHT.trustItems) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });
});

describe('DestaqueIa — CTA', () => {
  it('renders a CTA that links to /signup', () => {
    render(<DestaqueIa />);

    const cta = screen.getByRole('link', { name: AI_HIGHLIGHT.cta.label });
    // SSR / first render: SignupCta emits a stable `/signup` href before
    // hydration folds in any UTM params.
    expect(cta).toHaveAttribute('href', '/signup');
    expect(AI_HIGHLIGHT.cta.href).toBe('/signup');
  });
});
