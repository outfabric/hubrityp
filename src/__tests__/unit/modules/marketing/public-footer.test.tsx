import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PublicFooter } from '@/modules/marketing/components/public-footer';

/*
 * PublicFooter (Server Component, presentational) — task 7.2.
 *
 * Covers the spec contracts exercisable in jsdom:
 *   - legal link destinations (Política de Privacidade, Termos de Uso, LGPD anchor);
 *   - the support contact rendered as a `mailto:` link;
 *   - a SINGLE `contentinfo` landmark;
 *   - accessible column headings (Produto / Legal / Contato).
 */

function hrefOf(name: RegExp | string): string | null {
  const link = screen.getByRole('link', { name });
  return link.getAttribute('href');
}

describe('PublicFooter — legal link destinations', () => {
  it('points each legal link at its spec destination', () => {
    render(<PublicFooter />);

    expect(hrefOf(/^Política de Privacidade$/i)).toBe('/politica-de-privacidade');
    expect(hrefOf(/^Termos de Uso$/i)).toBe('/termos-de-uso');
    // LGPD deep-links into the LGPD section anchor of the privacy page.
    expect(hrefOf(/^LGPD$/i)).toBe('/politica-de-privacidade#lgpd');
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

    expect(hrefOf(/suporte@hubrity\.com\.br/i)).toBe('mailto:suporte@hubrity.com.br');
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

describe('PublicFooter — copyright', () => {
  it('renders the static 2026 copyright line with Brazil data-residency note', () => {
    render(<PublicFooter />);

    expect(
      screen.getByText(
        /© 2026 Hubrity\. Dados armazenados no Brasil\. Feito para psicólogos autônomos brasileiros\./i,
      ),
    ).toBeInTheDocument();
  });
});
