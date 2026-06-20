import * as React from 'react';

import { FaqAccordion } from '@/modules/marketing/components/home/faq-accordion';
import { BILLING_FAQ_ENTRIES } from '@/modules/marketing/lib/pricing-content';

/**
 * BillingFaq — the billing FAQ section of the pricing page (`/precos`).
 * --------------------------------------------------------------------------
 * A thin wrapper over the shared `FaqAccordion` (the SAME accessible
 * `<details>`-based accordion the homepage uses): no-JS all-open fallback plus
 * exclusive-open enhancement after hydration. It supplies the billing-specific
 * copy from `BILLING_FAQ_ENTRIES` — cobrança (monthly), cancelamento, fim do
 * teste/downgrade, and nota fiscal (framed as provider-dependent/forward-looking,
 * never as an included plan feature). All copy lives in the content layer, so
 * there is no inline prose to drift from `pricing-content.ts`.
 */
export function BillingFaq(): React.JSX.Element {
  return (
    <FaqAccordion
      entries={BILLING_FAQ_ENTRIES}
      title="Dúvidas sobre cobrança"
      titleId="billing-faq-title"
    />
  );
}

BillingFaq.displayName = 'BillingFaq';
