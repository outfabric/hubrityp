import * as React from 'react';

import { FaqAccordion } from '@/modules/marketing/components/home/faq-accordion';
import { FAQ_ENTRIES } from '@/modules/marketing/lib/home-content';

/**
 * Faq — the frequently-asked-questions section of the public homepage (`/`).
 * --------------------------------------------------------------------------
 * A thin wrapper over the shared `FaqAccordion` that supplies the homepage copy
 * (`FAQ_ENTRIES`) and heading. The accessible `<details>`-based accordion
 * behavior (no-JS all-open fallback + exclusive open after hydration) lives in
 * `FaqAccordion`, which is shared with the pricing-page billing FAQ.
 */
export function Faq(): React.JSX.Element {
  return <FaqAccordion entries={FAQ_ENTRIES} title="Perguntas frequentes" titleId="faq-title" />;
}

Faq.displayName = 'Faq';
