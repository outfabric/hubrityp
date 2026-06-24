// Confiança — the regulatory-trust section of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// reassures Brazilian psychologists that the platform is built around the exact
// regulatory framework they work under: a "CONFORMIDADE & SEGURANÇA" eyebrow
// (`Label/caption-upper`, `brand-700`), a title (`Display/md`), a panel of
// EXACTLY 8 guarantees (each with the literal CFP resolution numbers/years, LGPD
// data residency, AES-256/TLS 1.3 encryption, the 20-year medical-record
// retention of Lei 13.787/2018, and the CRP-ativo signup gate), and a closing
// line.
//
// The panel sits on `surface` with `radius-2xl`, a `border` and the smallest
// `Shadow/Light/xs`; the guarantees are a 2-column grid on desktop (Figma
// `123:2`) collapsing to a single column on mobile (`137:2`). Items 6 and 8
// carry a condensed mobile variant ([[ResponsiveCopy]]): the desktop string
// renders from `md` up, the condensed string below it, and the hidden variant is
// `aria-hidden` so assistive tech reads each line once.
//
// Each guarantee gets a `Check` icon tinted `brand/700` — the DS forbids adding
// an extra semantic green just for these checkmarks. All copy comes from `TRUST`
// in the content layer so the regulatory wording stays reviewable in one place
// and is asserted verbatim by the unit test.

import { Check } from 'lucide-react';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { TRUST, type RegulatoryGuarantee } from '@/modules/marketing/lib/home-content';

/**
 * The homepage regulatory-trust section. Renders the uppercase eyebrow, the
 * title, the eight checkmarked regulatory guarantees (brand/700 checks) inside a
 * surface panel, and the closing line. Purely presentational — no interactivity.
 */
export function Confianca(): React.JSX.Element {
  return (
    <section aria-labelledby="confianca-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center gap-6 text-center">
        {/* Eyebrow: Label/caption-upper (12/16, ls 6) in brand-700. */}
        <p className="text-brand-700 text-xs font-medium tracking-[0.06em] uppercase">
          {TRUST.eyebrow}
        </p>

        <h2
          id="confianca-title"
          className="text-display-md text-text-primary max-w-3xl text-balance"
        >
          {TRUST.title}
        </h2>

        {/* Guarantee panel: surface / radius-2xl / border / Shadow-Light-xs. */}
        <div className="bg-surface border-border mt-4 w-full max-w-3xl rounded-2xl border p-6 shadow-xs md:p-8">
          <ul className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2">
            {TRUST.guarantees.map((guarantee: RegulatoryGuarantee) => (
              <li key={guarantee.text.desktop} className="flex items-start gap-3">
                <Check aria-hidden="true" className="text-brand-700 mt-0.5 size-5 shrink-0" />
                {/* Desktop string from `md` up; condensed mobile string below it
                    (only items 6 & 8 differ — the rest fall back to desktop). */}
                <span className="text-text-secondary text-pretty">
                  <span className="hidden md:inline">{guarantee.text.desktop}</span>
                  <span
                    className="md:hidden"
                    aria-hidden={guarantee.text.mobile ? 'true' : undefined}
                  >
                    {guarantee.text.mobile ?? guarantee.text.desktop}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-lead text-text-primary mt-4 max-w-2xl font-medium text-pretty">
          {TRUST.closer}
        </p>
      </Container>
    </section>
  );
}

Confianca.displayName = 'Confianca';
