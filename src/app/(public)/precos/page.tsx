import type { Metadata } from 'next';
import * as React from 'react';

import {
  BillingFaq,
  buildPageMetadata,
  ComparisonTable,
  Container,
  CtaFinal,
  PlanCards,
  PRICING_PAGE,
} from '@/modules/marketing';

/**
 * Public pricing page (`/precos`) — the full plans + pricing surface.
 *
 * Server Component (presentational only — no client hooks, no PII, no secrets).
 * It is a PUBLIC route: an anonymous visitor must reach it with HTTP 200 (no
 * login redirect). `src/middleware.ts:classifyPath()` already classifies
 * `/precos` as `'public'`, and the integration suite asserts the no-redirect
 * contract for every session state — this page adds no gating of its own.
 *
 * It composes, in spec order (RF-14.26):
 *
 *   1. Header        — the single `<h1>` (page title) + subtitle
 *   2. PlanCards     — the two config-driven plan cards (CTA → /signup?plano=…)
 *   3. ComparisonTable — the expandable 9-row × 2-plan feature matrix
 *   4. BillingFaq    — the billing FAQ (cobrança / cancelamento / teste / NF)
 *   5. CtaFinal      — the closing call-to-action band (solid brand/700)
 *
 * Heading hierarchy: the page exposes exactly one `<h1>` (the header title in
 * this file); every section below starts at `<h2>`. The `(public)` layout
 * already provides the `<main>` landmark, so this page MUST NOT add its own.
 *
 * All copy comes from the content layer (`PRICING_PAGE`) and all plan data from
 * the central `PLANS` config (via the section components) — nothing is hardcoded
 * inline, so the configs are the single lever for what renders here.
 */
export const metadata: Metadata = buildPageMetadata({
  title: 'Planos e preços',
  description:
    'Dois planos com cobrança mensal e 14 dias grátis, sem cartão de crédito e sem fidelidade. Compare o Essencial e o Avançado e comece hoje.',
  path: '/precos',
});

export default function PricingPage(): React.JSX.Element {
  return (
    <>
      <section aria-labelledby="pricing-title" className="py-16 md:py-24">
        <Container className="flex flex-col items-center gap-10 text-center">
          <div className="flex max-w-2xl flex-col items-center gap-4">
            <p className="text-text-tertiary text-xs font-medium tracking-wider uppercase">
              Planos
            </p>
            <h1 id="pricing-title" className="text-display-lg text-text-primary text-balance">
              {PRICING_PAGE.title}
            </h1>
            <p className="text-text-secondary text-lead text-pretty">{PRICING_PAGE.subtitle}</p>
          </div>

          <PlanCards />
        </Container>
      </section>

      <ComparisonTable />
      <BillingFaq />
      <CtaFinal />
    </>
  );
}
