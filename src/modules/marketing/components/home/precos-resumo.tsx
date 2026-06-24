// Preços resumo — the pricing-summary section of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// shows a compact, monthly-only pricing teaser: a title, the two MVP plan
// cards (Essencial / Avançado, the latter flagged "Mais popular"), reassuring
// microcopy, and a link to the full `/precos` page.
//
// The plan NAMES, PRICES and the "Mais popular" badge come from the central
// `PLANS` config (`lib/plans.ts`) — never hardcoded here — so that changing the
// config is the single lever that changes what this teaser renders. Prices are
// stored as integer cents and formatted at this display layer with
// `Intl.NumberFormat('pt-BR', { currency: 'BRL' })` (design decision D7). The
// surrounding copy (title, microcopy, full-plans link) comes from
// `PRICING_SUMMARY` in the content layer.

import Link from 'next/link';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { PRICING_SUMMARY } from '@/modules/marketing/lib/home-content';
import { PLANS } from '@/modules/marketing/lib/plans';

/** pt-BR BRL formatter, instantiated once for the whole section. */
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
});

/** Formats integer cents (e.g. `6000`) as a BRL string (e.g. `R$ 60`). */
function formatMonthlyPrice(priceCents: number): string {
  return BRL.format(priceCents / 100);
}

/**
 * The homepage pricing-summary section. Renders the title, the two MVP plan
 * cards sourced from the central `PLANS` config (monthly only, with the
 * "Mais popular" badge driven by config), the reassurance microcopy, and the
 * "Ver planos completos →" link to `/precos`. Purely presentational.
 */
export function PrecosResumo(): React.JSX.Element {
  return (
    <section aria-labelledby="precos-resumo-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center gap-10 text-center">
        <h2
          id="precos-resumo-title"
          className="text-display-md text-text-primary max-w-2xl text-balance"
        >
          {PRICING_SUMMARY.title}
        </h2>

        <ul className="grid w-full max-w-3xl grid-cols-1 gap-6 text-left sm:grid-cols-2">
          {PLANS.map((plan) => (
            <li
              key={plan.slug}
              className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-6"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-text-primary text-lead font-semibold">{plan.name}</h3>
                {plan.badge ? (
                  <span className="bg-brand-50 text-brand-700 rounded-full px-3 py-1 text-xs font-medium">
                    {plan.badge}
                  </span>
                ) : null}
              </div>
              <p className="text-text-primary text-display-md font-semibold">
                <span>{formatMonthlyPrice(plan.priceCents)}</span>
                <span className="text-text-tertiary text-base font-normal"> /mês</span>
              </p>
            </li>
          ))}
        </ul>

        {/* Responsive desktop/mobile toggle is wired in the later UI section;
            for now render the canonical desktop copy to keep the teaser intact. */}
        <p className="text-text-secondary max-w-2xl text-pretty">
          {PRICING_SUMMARY.microcopy.desktop}
        </p>

        <Link
          href={PRICING_SUMMARY.fullPlansHref}
          className="text-brand-700 font-medium underline-offset-4 hover:underline"
        >
          {PRICING_SUMMARY.fullPlansLinkLabel}
        </Link>
      </Container>
    </section>
  );
}

PrecosResumo.displayName = 'PrecosResumo';
