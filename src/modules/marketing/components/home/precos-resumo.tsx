// Preços resumo — the pricing-summary section of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// shows a compact, monthly-only pricing teaser: an uppercase "PLANOS" eyebrow,
// the title, the two MVP plan cards (Essencial / Avançado, the latter flagged
// "Mais popular"), reassuring microcopy, and a link to the full `/precos` page.
//
// Each card carries the plan name, the monthly price + "/mês", a one-line
// tagline, a checkmarked summary of the plan's highlights, and a per-card
// "Começar grátis" CTA to `/signup`.
//
// The plan NAMES, PRICES and the "Mais popular" badge come from the central
// `PLANS` config (`lib/plans.ts`) — never hardcoded here — so that changing the
// config is the single lever that changes what this teaser renders. Prices are
// stored as integer cents and formatted at this display layer with
// `Intl.NumberFormat('pt-BR', { currency: 'BRL' })` (design decision D7). The
// surrounding copy (eyebrow, title, CTA label, per-card tagline + bullets,
// microcopy, full-plans link) comes from `PRICING_SUMMARY` in the content layer.
//
// Layout (Figma desktop `124:2` / mobile `137:47`):
//   - Desktop (`sm` and up): the two cards sit side by side.
//   - Mobile (below `sm`): the cards stack vertically.
//   - Title renders in `Display/lg`; the "Ver planos completos →" link and the
//     reassurance microcopy show on BOTH breakpoints (the microcopy condensing
//     between them — the conversion path to `/precos` is kept on mobile despite
//     the frame omitting it).

import { Check } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { SignupCta } from '@/modules/marketing/components/signup-cta';
import { PRICING_SUMMARY, pricingSummaryCardFor } from '@/modules/marketing/lib/home-content';
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
 * The homepage pricing-summary section. Renders the "PLANOS" eyebrow, the title,
 * the two MVP plan cards sourced from the central `PLANS` config (monthly only,
 * no annual toggle, with the "Mais popular" badge driven by config), curated
 * taglines + checkmarked bullets and a per-card "Começar grátis" CTA, the
 * reassurance microcopy, and the "Ver planos completos →" link to `/precos`.
 * Purely presentational.
 */
export function PrecosResumo(): React.JSX.Element {
  return (
    <section aria-labelledby="precos-resumo-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-4">
          {/* Eyebrow: Label/caption-upper (12/16, ls 6) in brand-700. */}
          <p className="text-brand-700 text-xs font-medium tracking-[0.06em] uppercase">
            {PRICING_SUMMARY.eyebrow}
          </p>

          <h2
            id="precos-resumo-title"
            className="text-display-lg text-text-primary max-w-2xl text-balance"
          >
            {PRICING_SUMMARY.title}
          </h2>
        </div>

        {/* Two cards: side by side from `sm` up, stacked below it. */}
        <ul className="grid w-full max-w-3xl grid-cols-1 gap-6 text-left sm:grid-cols-2">
          {PLANS.map((plan) => {
            const card = pricingSummaryCardFor(plan.slug);

            return (
              <li
                key={plan.slug}
                className="border-border bg-surface flex flex-col gap-5 rounded-2xl border p-6"
              >
                <div className="flex flex-col gap-3">
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

                  {/* One-line tagline: condensed below `md`, full from `md` up. */}
                  <p className="text-text-secondary text-pretty">
                    <span className="md:hidden" aria-hidden="true">
                      {card.tagline.mobile ?? card.tagline.desktop}
                    </span>
                    <span className="hidden md:inline">{card.tagline.desktop}</span>
                  </p>
                </div>

                {/* Curated highlight bullets with brand-600 checks. */}
                <ul className="flex flex-col gap-3">
                  {card.bullets.map((bullet) => (
                    <li key={bullet.desktop} className="flex items-start gap-3">
                      <Check aria-hidden="true" className="text-brand-600 mt-0.5 size-5 shrink-0" />
                      <span className="text-text-secondary text-pretty">
                        <span className="md:hidden" aria-hidden="true">
                          {bullet.mobile ?? bullet.desktop}
                        </span>
                        <span className="hidden md:inline">{bullet.desktop}</span>
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Per-card primary CTA to `/signup`. Pushed to the bottom so the
                    two cards' CTAs align even when the bullet lists differ. */}
                <SignupCta className="mt-auto w-full">{PRICING_SUMMARY.ctaLabel}</SignupCta>
              </li>
            );
          })}
        </ul>

        {/* Reassurance microcopy: condensed below `md`, full from `md` up. */}
        <p className="text-text-secondary max-w-2xl text-pretty">
          <span className="md:hidden" aria-hidden="true">
            {PRICING_SUMMARY.microcopy.mobile ?? PRICING_SUMMARY.microcopy.desktop}
          </span>
          <span className="hidden md:inline">{PRICING_SUMMARY.microcopy.desktop}</span>
        </p>

        {/* "Ver planos completos →" link to `/precos` — rendered on BOTH
            breakpoints (the conversion path is kept on mobile despite the frame
            omission). */}
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
