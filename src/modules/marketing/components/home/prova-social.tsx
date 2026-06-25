// ProvaSocial — the market-data bar below the hero on the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// renders a `surface-muted` band with the two market statistics from the
// content layer (`SOCIAL_PROOF_STATS`), each a large figure (`Display/md`,
// `text-primary`) over a supporting caption (`Body/base`, `text-secondary`).
//
// Layout (Figma desktop `113:2` / mobile `135:2`): the two stat blocks sit
// side by side separated by a 1px `border-strong` vertical divider on desktop,
// and stack vertically with no divider on mobile.
//
// Spec guard: this section MUST NOT contain fabricated testimonials or invented
// metrics — only the two reviewed market-data figures live in `home-content.ts`,
// and `prova-problema.test.tsx` asserts that invariant.

import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { SOCIAL_PROOF_STATS } from '@/modules/marketing/lib/home-content';

/**
 * The homepage social-proof bar. Renders the two market-data figure+caption
 * stat blocks on a muted surface. Purely presentational — no interactivity.
 */
export function ProvaSocial(): React.JSX.Element {
  return (
    <section aria-label="Dados de mercado" className="bg-surface-muted py-10 md:py-12">
      <Container className="grid gap-8 sm:grid-cols-2 sm:gap-0">
        {SOCIAL_PROOF_STATS.map((stat, index) => (
          <div
            key={stat.figure}
            className={
              // First block carries no divider; the second adds a 1px
              // `border-strong` vertical divider on desktop only (`sm:` up).
              // Mobile stacks with no divider.
              index > 0
                ? 'sm:border-border-strong text-center sm:border-l sm:pl-12 sm:text-left'
                : 'text-center sm:pr-12 sm:text-left'
            }
          >
            <p className="text-display-md text-text-primary">{stat.figure}</p>
            <p className="text-text-secondary mt-2 text-[15px]/[22px] text-pretty">
              {stat.caption}
            </p>
          </div>
        ))}
      </Container>
    </section>
  );
}

ProvaSocial.displayName = 'ProvaSocial';
