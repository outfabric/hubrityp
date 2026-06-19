// Confiança — the regulatory-trust section of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// reassures Brazilian psychologists that the platform is built around the exact
// regulatory framework they work under: a title, a checklist of EXACTLY 8
// guarantees (each with the literal CFP resolution numbers/years, LGPD data
// residency, AES-256/TLS 1.3 encryption, the 20-year medical-record retention
// of Lei 13.787/2018, and the CRP-ativo signup gate), and a closing line.
//
// Each guarantee gets a `Check` icon tinted `brand/700` — the DS forbids adding
// an extra semantic green just for these checkmarks. All copy comes from `TRUST`
// in the content layer so the regulatory wording stays reviewable in one place
// and is asserted verbatim by the unit test.

import { Check } from 'lucide-react';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { TRUST } from '@/modules/marketing/lib/home-content';

/**
 * The homepage regulatory-trust section. Renders the title, the eight
 * checkmarked regulatory guarantees (brand/700 checks), and the closing line.
 * Purely presentational — no interactivity.
 */
export function Confianca(): React.JSX.Element {
  return (
    <section aria-labelledby="confianca-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center gap-10 text-center">
        <h2
          id="confianca-title"
          className="text-display-md text-text-primary max-w-3xl text-balance"
        >
          {TRUST.title}
        </h2>

        <ul className="grid w-full max-w-3xl grid-cols-1 gap-4 text-left sm:grid-cols-2">
          {TRUST.guarantees.map((guarantee) => (
            <li key={guarantee.text} className="flex items-start gap-3">
              <Check aria-hidden="true" className="text-brand-700 mt-0.5 size-5 shrink-0" />
              <span className="text-text-secondary text-pretty">{guarantee.text}</span>
            </li>
          ))}
        </ul>

        <p className="text-lead text-text-primary max-w-2xl font-medium text-pretty">
          {TRUST.closer}
        </p>
      </Container>
    </section>
  );
}

Confianca.displayName = 'Confianca';
