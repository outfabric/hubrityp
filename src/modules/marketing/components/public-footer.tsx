import Link from 'next/link';
import * as React from 'react';

import { Logo } from '@/shared/ui/logo';

import { Container } from './container';

/**
 * PublicFooter — the marketing site footer (Figma frame `131:32`).
 *
 * A stateless Server Component (no client hooks, no authenticated data) that is
 * ALSO reusable by the authenticated app — it renders nothing user-specific, so
 * dropping it into a private layout leaks no PII.
 *
 * Dark surface, always:
 *   The footer is rendered on a dark surface REGARDLESS of the active page
 *   theme. We force that with a `data-theme="dark"` wrapper so the design-system
 *   color tokens (`bg-background`, `text-primary`, `border-subtle`, …) resolve
 *   to their dark-mode values within this subtree, instead of hardcoding hex.
 *   The brand mark uses the `tone="inverse"` Logo variant: the symbol keeps its
 *   tricolor brand fills while the "hubrity" wordmark renders light, so the
 *   lockup reads on the dark surface without flattening to an all-white mark.
 *
 * Layout (Figma `131:32`):
 *   Brand block on the LEFT (lockup + tagline); the Produto / Legal / Contato
 *   link columns clustered to the RIGHT. Column headings use the uppercase
 *   tertiary caption style (`caption-upper`).
 *
 * Accessibility:
 *   The single implicit `role="contentinfo"` on `<footer>` is the only
 *   contentinfo landmark on the page. Each column is a `<nav>`/region with an
 *   accessible heading (`aria-labelledby`) so the columns are announced.
 *
 * Links are all static, allowlisted destinations — none are built from user
 * input, so there is no open-redirect surface here.
 */

/** Static copyright year — fixed per the Figma copy (not render-time). */
const COPYRIGHT_YEAR = 2026;

/** Support contact — surfaced as a `mailto:` link in the "Contato" column. */
const SUPPORT_EMAIL = 'hubrity.platform@gmail.com';

/** Uppercase tertiary caption style for the column headings (Figma `131:32`). */
const COLUMN_HEADING_CLASS = 'text-text-tertiary text-xs font-medium uppercase tracking-[0.06em]';

/** Shared link styling across the footer columns. */
const FOOTER_LINK_CLASS = 'text-text-secondary hover:text-text-primary text-sm transition-colors';

type FooterLink = { href: string; label: string };

const PRODUCT_LINKS: ReadonlyArray<FooterLink> = [
  // Same-page anchor on the homepage; a path-prefixed hash works from any
  // public page. Path-relative, allowlisted — not user input.
  { href: '/#funcionalidades', label: 'Funcionalidades' },
  { href: '/precos', label: 'Preços' },
];

const LEGAL_LINKS: ReadonlyArray<FooterLink> = [
  { href: '/politica-de-privacidade', label: 'Política de Privacidade' },
  { href: '/termos-de-uso', label: 'Termos de Uso' },
];

/** A labelled column of footer links, announced as a navigation region. */
function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: ReadonlyArray<FooterLink>;
}): React.JSX.Element {
  const headingId = React.useId();
  return (
    <nav aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className={COLUMN_HEADING_CLASS}>
        {heading}
      </h2>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={FOOTER_LINK_CLASS}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function PublicFooter(): React.JSX.Element {
  const contatoHeadingId = React.useId();

  return (
    // `data-theme="dark"` forces the dark token palette in this subtree so the
    // footer stays dark even on a light-themed page. `bg-background` then
    // resolves to the dark ink surface (#1c1917).
    <footer data-theme="dark" className="bg-background border-border-subtle border-t">
      <Container className="py-12">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          {/* Brand + tagline block — left. */}
          <div className="flex max-w-xs flex-col gap-4">
            <Logo variant="lockup-h" tone="inverse" className="h-8 w-auto" />
            <p className="text-text-secondary text-sm">
              O sistema único para o consultório de psicólogos autônomos no Brasil.
            </p>
          </div>

          {/* Link columns — clustered to the right. */}
          <div className="flex flex-col gap-10 sm:flex-row sm:gap-16">
            <FooterColumn heading="Produto" links={PRODUCT_LINKS} />
            <FooterColumn heading="Legal" links={LEGAL_LINKS} />

            {/* Contato column — the support email as a mailto: link. */}
            <nav aria-labelledby={contatoHeadingId} className="flex flex-col gap-3">
              <h2 id={contatoHeadingId} className={COLUMN_HEADING_CLASS}>
                Contato
              </h2>
              <ul className="flex flex-col gap-2">
                <li>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className={FOOTER_LINK_CLASS}>
                    {SUPPORT_EMAIL}
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="border-border-subtle mt-10 border-t pt-6">
          <p className="text-text-tertiary text-sm">
            © {COPYRIGHT_YEAR} Hubrity. Feito para psicólogos autônomos brasileiros.
          </p>
        </div>
      </Container>
    </footer>
  );
}

PublicFooter.displayName = 'PublicFooter';
