import Link from 'next/link';
import * as React from 'react';

import { Logo } from '@/shared/ui/logo';

import { Container } from './container';

/**
 * PublicFooter — the marketing site footer (Figma desktop `126:7` / mobile
 * `138:36`).
 *
 * A stateless Server Component (no client hooks, no authenticated data) that is
 * ALSO reusable by the authenticated app — it renders nothing user-specific, so
 * dropping it into a private layout leaks no PII.
 *
 * Dark surface, always:
 *   The footer is rendered on a dark surface REGARDLESS of the active page
 *   theme. We force that with a `data-theme="dark"` wrapper so the design-system
 *   color tokens resolve to their dark-context values within this subtree
 *   instead of hardcoding hex. On the dark surface they resolve to the exact
 *   Figma values: `bg-background` → `#1c1917`, `text-text-secondary` →
 *   `#d6d3d1`, `text-text-tertiary` → `#a8a29e`, `border`/`bg-border` →
 *   `#3a3633` (see `[data-theme='dark']` in `globals.css`).
 *   The brand mark uses the `tone="inverse"` Logo variant: the symbol keeps its
 *   tricolor brand fills while the "hubrity" wordmark renders light, so the
 *   lockup reads on the dark surface without flattening to an all-white mark.
 *
 * Layout:
 *   - Desktop (`126:7`): brand block on the LEFT (lockup + tagline); the
 *     Produto / Legal / Contato link columns clustered to the RIGHT on one row;
 *     a short divider rule then the copyright line below.
 *   - Mobile (`138:36`): the brand block, the three columns, the divider, and
 *     the copyright stack vertically in that order.
 *   Column headings use the uppercase tertiary caption style (`caption-upper`);
 *   the tagline and copyright are `Body/sm` in `text-tertiary`; links are
 *   `text-secondary`.
 *
 * Brand lockup alignment (`126:10`):
 *   The lockup row is wrapped in a `w-fit self-start` box so its rendered box
 *   hugs the mark's intrinsic width. Without it, the `<Logo>` `<svg>` stretches
 *   to the brand block's column width (the flex item stretches on the cross
 *   axis) and the mark is pushed right of the tagline. We constrain the wrapper
 *   here — NOT the shared `Logo` primitive — so the header/app shell are
 *   unaffected.
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
const SUPPORT_EMAIL = 'suporte@hubrity.com';

/**
 * Uppercase tertiary caption style for the column headings — `Label/caption-upper`
 * (12/16, letter-spacing 6 ≈ `0.06em`) in `text-tertiary` (Figma `126:18`).
 */
const COLUMN_HEADING_CLASS = 'text-text-tertiary text-xs font-medium uppercase tracking-[0.06em]';

/**
 * Shared link styling across the footer columns — `text-secondary` in
 * `Body/base` (15/22) on mobile (`138:44`) and `Body/sm` (13/20) from `md` up
 * (`126:19`).
 */
const FOOTER_LINK_CLASS =
  'text-text-secondary hover:text-text-primary text-[15px] leading-[22px] md:text-[13px] md:leading-[20px] transition-colors';

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
    // footer stays dark even on a light-themed page. `bg-background` resolves to
    // the dark ink surface (#1c1917). Vertical rhythm matches Figma: pt-48/pb-32
    // on mobile (`138:36`), pt-64/pb-40 from `md` up (`126:7`).
    <footer data-theme="dark" className="bg-background">
      <Container className="pt-12 pb-8 md:pt-16 md:pb-10">
        {/*
         * Mobile: a single stacked column (brand → tagline → columns → divider →
         * copyright). From `md` up the brand block and the link cluster sit on
         * one row; the divider rule and copyright follow below.
         */}
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
            {/* Brand + tagline block — left on desktop, top on mobile. */}
            <div className="flex max-w-[360px] flex-col gap-3">
              {/*
               * `w-fit self-start` constrains the lockup box to the mark's
               * intrinsic width so it is flush-left with the tagline below —
               * without it the SVG flex item stretches to the 360px column and
               * the mark is pushed right (see file header).
               */}
              <Logo variant="lockup-h" tone="inverse" className="h-[27px] w-fit self-start" />
              <p className="text-text-tertiary text-[13px] leading-[20px]">
                O sistema único para o consultório de psicólogos autônomos no Brasil.
              </p>
            </div>

            {/* Link columns — clustered to the right on desktop, stacked on mobile. */}
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

          {/* Short divider rule (Figma `126:29` / `138:54`): 100px, dark border. */}
          <div className="bg-border h-px w-[100px]" role="presentation" />

          <p className="text-text-tertiary text-[13px] leading-[20px]">
            © {COPYRIGHT_YEAR} Hubrity. Feito para psicólogos autônomos brasileiros.
          </p>
        </div>
      </Container>
    </footer>
  );
}

PublicFooter.displayName = 'PublicFooter';
