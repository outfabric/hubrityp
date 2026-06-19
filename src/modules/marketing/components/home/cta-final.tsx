// CTA final — the closing call-to-action band of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// sits on a SOLID `brand/700` surface with inverse text — no gradient, glow or
// blur (a DS prohibition asserted by the unit test) — and makes the final push
// to signup: a title, a single CTA to `/signup`, and reassuring microcopy.
//
// The CTA is a fixed internal `/signup` link rendered through `SignupCta`,
// which folds in allowlisted UTM params client-side; the target is a constant
// path, so this is not an open-redirect sink. On the dark brand/700 surface the
// CTA uses the `secondary` Button variant (light fill) so it reads against the
// inverse background. All copy comes from `FINAL_CTA` in the content layer.

import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { SignupCta } from '@/modules/marketing/components/signup-cta';
import { FINAL_CTA } from '@/modules/marketing/lib/home-content';

/**
 * The homepage closing CTA section. Solid `brand/700` surface with inverse
 * text, the closing title, a `/signup` CTA (UTM-preserving), and reassurance
 * microcopy. Purely presentational — no interactivity.
 */
export function CtaFinal(): React.JSX.Element {
  return (
    <section
      aria-labelledby="cta-final-title"
      // Solid brand/700 surface with inverse text — intentionally no gradient /
      // glow / blur (DS rule).
      className="bg-brand-700 text-text-inverse py-16 md:py-24"
    >
      <Container className="flex flex-col items-center gap-6 text-center">
        <h2
          id="cta-final-title"
          className="text-display-md text-text-inverse max-w-2xl text-balance"
        >
          {FINAL_CTA.title}
        </h2>

        {/* Same guard as the Destaque-IA CTA: the DS Button is `whitespace-nowrap`
            + `px-8`, so a long label ("Criar conta grátis — 14 dias") can overflow
            the viewport on the narrowest phones. Let it wrap on mobile and restore
            the single-line DS treatment from `md` up. */}
        <SignupCta
          size="lg"
          variant="secondary"
          className="h-auto max-w-full py-3 text-center whitespace-normal md:h-12 md:py-2 md:whitespace-nowrap"
        >
          {FINAL_CTA.cta.label}
        </SignupCta>

        <p className="text-text-inverse/80 max-w-xl text-pretty">{FINAL_CTA.microcopy}</p>
      </Container>
    </section>
  );
}

CtaFinal.displayName = 'CtaFinal';
