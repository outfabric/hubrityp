'use client';

// Plan cards — the two config-driven pricing cards of the `/precos` page.
// --------------------------------------------------------------------------
// Presentational, but a CLIENT leaf: each card's CTA points at
// `/signup?plano=<slug>` and must fold in the visitor's `utm_*` (and click-id)
// params at click time. Mirroring `SignupCta`, the SSR markup emits a stable,
// crawlable `/signup?plano=<slug>` and only gains the tracking params after
// hydration (`withUtmFromLocation`). The `<slug>` is ALWAYS an allowlisted value
// taken from the central `PLANS` config (design decision D3) — never free-form
// input — so the CTA target is a fixed internal path and not an open-redirect
// or open-parameter sink.
//
// Plan NAMES, PRICES, the "Popular" badge and the per-plan feature list all come
// from the central `PLANS` config (`lib/plans.ts`); the surrounding CTA label is
// content (`PRICING_PAGE`). Nothing here is hardcoded, so changing the config is
// the single lever that changes what the cards render. Prices are integer cents
// formatted at this display layer with `Intl.NumberFormat('pt-BR', BRL)`
// (design decision D7). Billing is monthly only — there is intentionally no
// annual toggle (RF-14.28 / RN-14.05).
//
// When the validated config resolves to ZERO plans, the cards are hidden and the
// empty-plans fallback (`emptyPlansFallback()`) is shown instead — a "contact
// us" message plus the support email — so the page never renders an empty grid.

import { Check } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import {
  emptyPlansFallback,
  FEATURE_LABELS,
  PLANS,
  type Plan,
} from '@/modules/marketing/lib/plans';
import { PRICING_PAGE } from '@/modules/marketing/lib/pricing-content';
import { withUtmFromLocation } from '@/modules/marketing/lib/utm';
import { Button } from '@/shared/ui/button';

/** pt-BR BRL formatter, instantiated once for the whole section (D7: cents → BRL). */
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
 * Builds the (pre-hydration) CTA href for a plan: `/signup?plano=<slug>`. The
 * slug is the branded, allowlisted config slug, so this is a fixed internal path.
 */
function signupPathForPlan(slug: Plan['slug']): string {
  return `/signup?plano=${slug}`;
}

/** Tracking-param-preserving CTA for a single plan card. */
function PlanCta({ plan }: { readonly plan: Plan }): React.JSX.Element {
  const basePath = signupPathForPlan(plan.slug);

  // SSR / first render: stable `/signup?plano=<slug>`. After hydration, fold in
  // the allowlisted `utm_*` params present on the current URL (the helper
  // composes the `&` separator since the base already carries `?plano=`).
  const [href, setHref] = React.useState(basePath);

  React.useEffect(() => {
    const next = withUtmFromLocation(basePath);
    // Deferred to the next frame so it is not a synchronous setState inside the
    // effect body (React Compiler `set-state-in-effect` rule).
    const id = requestAnimationFrame(() => setHref(next));
    return () => cancelAnimationFrame(id);
  }, [basePath]);

  // Highlighted (badged) plan gets the primary fill; the other gets the outline
  // treatment, matching the Figma plan-cards frame.
  const variant = plan.badge ? 'default' : 'outline';

  return (
    <Button asChild variant={variant} size="lg" className="w-full">
      <Link href={href}>{PRICING_PAGE.ctaLabel}</Link>
    </Button>
  );
}

/** One plan card: name + optional badge, price, tagline-free feature list, CTA. */
function PlanCard({ plan }: { readonly plan: Plan }): React.JSX.Element {
  // The "full feature checklist": every feature this plan INCLUDES, labelled with
  // the verbatim RF-14.27 wording from the central config.
  const includedFeatures = plan.features.filter((feature) => feature.included);

  // The badged plan is visually emphasised with a thicker brand border.
  const cardBorder = plan.badge ? 'border-2 border-brand-400' : 'border border-border';

  return (
    <li className={`bg-surface ${cardBorder} flex flex-col gap-5 rounded-2xl p-8 shadow-xs`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-text-primary text-lead font-semibold">{plan.name}</h3>
        {plan.badge ? (
          <span className="bg-brand-600 text-text-inverse rounded-full px-3 py-1 text-xs font-medium">
            {plan.badge}
          </span>
        ) : null}
      </div>

      <p className="flex items-baseline gap-1">
        <span className="text-text-primary text-display-lg font-semibold">
          {formatMonthlyPrice(plan.priceCents)}
        </span>
        <span className="text-text-tertiary text-lg font-normal">/mês</span>
      </p>

      <PlanCta plan={plan} />

      <ul className="flex flex-col gap-2.5">
        {includedFeatures.map((feature) => (
          <li key={feature.key} className="flex items-start gap-2.5">
            <Check aria-hidden="true" className="text-brand-700 mt-0.5 size-4 shrink-0" />
            <span className="text-text-primary text-sm">{FEATURE_LABELS[feature.key]}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * The `/precos` plan-cards section. Renders one card per plan in the central
 * `PLANS` config (monthly only, "Popular" badge driven by config, full
 * checkmarked feature list, CTA → `/signup?plano=<slug>` with UTM preserved).
 * When the config resolves to zero plans, it renders the empty-plans fallback
 * (a "contact us" message + support email) instead of an empty grid.
 */
export function PlanCards(): React.JSX.Element {
  if (PLANS.length === 0) {
    const fallback = emptyPlansFallback();
    return (
      <section aria-label="Planos" className="flex flex-col items-center gap-3 text-center">
        <p className="text-text-primary text-lead text-pretty">{fallback.message}</p>
        <a
          href={`mailto:${fallback.supportEmail}`}
          className="text-brand-700 font-medium underline-offset-4 hover:underline"
        >
          {fallback.supportEmail}
        </a>
      </section>
    );
  }

  return (
    <section aria-label="Planos" className="flex justify-center">
      <ul className="grid w-full max-w-[55rem] grid-cols-1 items-stretch gap-6 sm:grid-cols-2">
        {PLANS.map((plan) => (
          <PlanCard key={plan.slug} plan={plan} />
        ))}
      </ul>
    </section>
  );
}

PlanCards.displayName = 'PlanCards';
