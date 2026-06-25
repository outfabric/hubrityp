import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PublicFooter } from '@/modules/marketing/components/public-footer';

/*
 * PublicFooter (Server Component, presentational) — Figma desktop `126:7` /
 * mobile `138:36`.
 *
 * Covers the spec contracts exercisable in jsdom:
 *   - legal link destinations (Política de Privacidade, Termos de Uso) — exactly
 *     two links, no standalone LGPD link;
 *   - the support contact rendered as a `mailto:` link;
 *   - a SINGLE `contentinfo` landmark;
 *   - accessible column headings (Produto / Legal / Contato);
 *   - the dark surface: a `data-theme="dark"` subtree so the DS tokens resolve
 *     to their dark-context values (`bg-background` #1c1917, `text-tertiary`
 *     #a8a29e, `text-secondary` #d6d3d1, `bg-border` #3a3633);
 *   - the brand lockup is flush-left: its box hugs the mark's intrinsic width
 *     (`w-fit`) and is NOT stretched to the brand block's column width.
 */

const SUPPORT_EMAIL = 'suporte@hubrity.com';

function hrefOf(name: RegExp | string): string | null {
  const link = screen.getByRole('link', { name });
  return link.getAttribute('href');
}

describe('PublicFooter — legal link destinations', () => {
  it('points each legal link at its spec destination', () => {
    render(<PublicFooter />);

    expect(hrefOf(/^Política de Privacidade$/i)).toBe('/politica-de-privacidade');
    expect(hrefOf(/^Termos de Uso$/i)).toBe('/termos-de-uso');
  });

  it('exposes exactly two links in the Legal column — no standalone LGPD link', () => {
    render(<PublicFooter />);

    const legal = screen.getByRole('navigation', { name: /^Legal$/i });
    const links = within(legal).getAllByRole('link');

    expect(links).toHaveLength(2);
    expect(links.map((link) => link.textContent)).toEqual([
      'Política de Privacidade',
      'Termos de Uso',
    ]);
    expect(screen.queryByRole('link', { name: /^LGPD$/i })).toBeNull();
  });

  it('points the Produto links at their spec destinations', () => {
    render(<PublicFooter />);

    expect(hrefOf(/^Funcionalidades$/i)).toBe('/#funcionalidades');
    expect(hrefOf(/^Preços$/i)).toBe('/precos');
  });
});

describe('PublicFooter — contact', () => {
  it('renders the support email as a mailto: link', () => {
    render(<PublicFooter />);

    expect(hrefOf(new RegExp(SUPPORT_EMAIL.replace('.', '\\.'), 'i'))).toBe(
      `mailto:${SUPPORT_EMAIL}`,
    );
  });
});

describe('PublicFooter — landmarks & headings', () => {
  it('exposes exactly one contentinfo landmark', () => {
    render(<PublicFooter />);

    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  });

  it('renders an accessible heading for each column', () => {
    render(<PublicFooter />);

    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('heading', { name: /^Produto$/i })).toBeInTheDocument();
    expect(within(footer).getByRole('heading', { name: /^Legal$/i })).toBeInTheDocument();
    expect(within(footer).getByRole('heading', { name: /^Contato$/i })).toBeInTheDocument();
  });

  it('labels each link column as an accessible navigation region', () => {
    render(<PublicFooter />);

    // Produto, Legal, and Contato are each a labelled <nav>.
    expect(screen.getByRole('navigation', { name: /^Produto$/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /^Legal$/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /^Contato$/i })).toBeInTheDocument();
  });
});

describe('PublicFooter — dark surface', () => {
  it('forces the dark token palette via a data-theme="dark" subtree', () => {
    render(<PublicFooter />);

    const footer = screen.getByRole('contentinfo');
    // The dark-context tokens (#1c1917 bg, #a8a29e tertiary, #d6d3d1 secondary,
    // #3a3633 border) resolve from `[data-theme='dark']` in globals.css — we
    // assert the wrapper carries the theme rather than re-asserting hex here.
    expect(footer).toHaveAttribute('data-theme', 'dark');
    expect(footer).toHaveClass('bg-background');
  });

  it('renders the tagline and copyright in the tertiary tone (Body/sm)', () => {
    render(<PublicFooter />);

    const tagline = screen.getByText(
      /O sistema único para o consultório de psicólogos autônomos no Brasil\./i,
    );
    const copyright = screen.getByText(
      /© 2026 Hubrity\. Feito para psicólogos autônomos brasileiros\./i,
    );

    expect(tagline).toHaveClass('text-text-tertiary');
    expect(copyright).toHaveClass('text-text-tertiary');
  });

  it('uses the dark border token for the divider rule', () => {
    const { container } = render(<PublicFooter />);

    // The short divider rule (Figma `126:29`/`138:54`) is a 100px-wide,
    // 1px-tall bar using the dark `bg-border` (#3a3633) token.
    const rule = container.querySelector('div.bg-border.h-px');
    expect(rule).not.toBeNull();
    expect(rule).toHaveClass('w-[100px]');
  });

  it('renders each column heading in the uppercase tertiary caption tone', () => {
    render(<PublicFooter />);

    for (const name of [/^Produto$/i, /^Legal$/i, /^Contato$/i]) {
      const heading = screen.getByRole('heading', { name });
      expect(heading).toHaveClass('text-text-tertiary', 'uppercase');
    }
  });

  it('renders the footer links in the secondary tone', () => {
    render(<PublicFooter />);

    const link = screen.getByRole('link', { name: /^Funcionalidades$/i });
    expect(link).toHaveClass('text-text-secondary');
  });
});

describe('PublicFooter — brand lockup alignment', () => {
  it('hugs the lockup to its intrinsic width so it is flush-left, not stretched', () => {
    render(<PublicFooter />);

    // The Logo renders an <svg role="img" aria-label="Hubrity">. Its box must
    // hug the mark's intrinsic width (`w-fit`) — NOT stretch to the brand
    // block's column width (which would push the mark right of the tagline).
    const lockup = screen.getByRole('img', { name: /^Hubrity$/i });
    expect(lockup).toHaveClass('w-fit', 'self-start');
    // Defensive: a full-width / max-width stretch class would re-introduce the
    // regression this guards against.
    expect(lockup).not.toHaveClass('w-full', 'w-auto');
  });

  it('caps the brand block to the Figma 360px column width', () => {
    render(<PublicFooter />);

    const tagline = screen.getByText(
      /O sistema único para o consultório de psicólogos autônomos no Brasil\./i,
    );
    const brandBlock = tagline.parentElement;
    expect(brandBlock).toHaveClass('max-w-[360px]');
  });
});

describe('PublicFooter — copy', () => {
  it('renders the Figma tagline in the brand block', () => {
    render(<PublicFooter />);

    expect(
      screen.getByText(/O sistema único para o consultório de psicólogos autônomos no Brasil\./i),
    ).toBeInTheDocument();
  });

  it('renders the static 2026 copyright line without the data-residency note', () => {
    render(<PublicFooter />);

    expect(
      screen.getByText(/© 2026 Hubrity\. Feito para psicólogos autônomos brasileiros\./i),
    ).toBeInTheDocument();
    // The standalone "Dados armazenados no Brasil." note was dropped per Figma.
    expect(screen.queryByText(/Dados armazenados no Brasil/i)).toBeNull();
  });
});
