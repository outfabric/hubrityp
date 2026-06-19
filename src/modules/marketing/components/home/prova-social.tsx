// ProvaSocial — the market-data bar below the hero on the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// renders a `bg/surface-muted` band with the two market statistics from the
// content layer (`SOCIAL_PROOF_STATS`).
//
// Spec guard: this section MUST NOT contain fabricated testimonials or invented
// metrics — only the two reviewed market-data statements live in
// `home-content.ts`, and `prova-problema.test.tsx` asserts that invariant.

import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { SOCIAL_PROOF_STATS } from '@/modules/marketing/lib/home-content';

/**
 * The homepage social-proof bar. Renders the two market-data statistics on a
 * muted surface. Purely presentational — no interactivity.
 */
export function ProvaSocial(): React.JSX.Element {
  return (
    <section aria-label="Dados de mercado" className="bg-surface-muted py-10 md:py-12">
      <Container className="grid gap-8 sm:grid-cols-2 sm:gap-12">
        {SOCIAL_PROOF_STATS.map((stat) => (
          <p
            key={stat.text}
            className="text-text-secondary text-center text-base text-pretty sm:text-left"
          >
            {stat.text}
          </p>
        ))}
      </Container>
    </section>
  );
}

ProvaSocial.displayName = 'ProvaSocial';
