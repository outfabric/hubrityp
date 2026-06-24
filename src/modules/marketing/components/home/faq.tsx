import * as React from 'react';

import { FaqAccordion } from '@/modules/marketing/components/home/faq-accordion';
import { FAQ_ENTRIES, FAQ_EYEBROW, FAQ_TITLE } from '@/modules/marketing/lib/home-content';

/**
 * Faq — the frequently-asked-questions section of the public homepage (`/`).
 * --------------------------------------------------------------------------
 * A thin wrapper over the shared `FaqAccordion` that supplies the homepage copy
 * (`FAQ_ENTRIES`), the desktop-only "PERGUNTAS FREQUENTES" eyebrow (`125:2`; the
 * mobile frame `138:2` omits it) and the "Ainda em dúvida? Comece por aqui."
 * title. The accessible `<details>`-based accordion behavior (no-JS all-open
 * fallback + exclusive open after hydration) lives in `FaqAccordion`, which is
 * shared with the pricing-page billing FAQ.
 */
export function Faq(): React.JSX.Element {
  return (
    <FaqAccordion
      entries={FAQ_ENTRIES}
      eyebrow={FAQ_EYEBROW}
      title={FAQ_TITLE}
      titleId="faq-title"
    />
  );
}

Faq.displayName = 'Faq';
