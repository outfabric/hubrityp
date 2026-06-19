// Destaque IA — the AI-highlight section of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presentational Server Component (no client hooks, no PII, no secrets). It
// sits on a SOLID `brand/50` surface — no gradient, glow or blur (a DS
// prohibition asserted by the unit test) — and frames the time-saving promise
// of the clinical AI with a quantified title, an explanatory subtitle, an
// antes/depois comparison, four trust/safety guarantees, and a single CTA to
// `/signup`.
//
// The "antes" panel is a CSS mockup of an empty evolution editor (no real
// screenshot needed); the "depois" panel uses the real `evolucao.webp`
// screenshot via `next/image`. The screenshot source comes from `SCREENSHOTS`
// (a closed, build-time map) — never from user input — so there is no URL sink.
//
// The CTA is a fixed internal `/signup` link rendered through `SignupCta`, which
// folds in allowlisted UTM params client-side; the target is a constant path, so
// this is not an open-redirect sink. All copy comes from `AI_HIGHLIGHT` in the
// content layer, keeping the regulatory/trust wording reviewable in one place.

import { CheckCircle2 } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import { SignupCta } from '@/modules/marketing/components/signup-cta';
import { AI_HIGHLIGHT, SCREENSHOTS } from '@/modules/marketing/lib/home-content';

/**
 * The homepage AI-highlight section. Solid `brand/50` surface, quantified title,
 * antes/depois comparison (empty editor vs. AI-filled evolução), four trust
 * items, and a `/signup` CTA. Purely presentational — no interactivity.
 */
export function DestaqueIa(): React.JSX.Element {
  const evolucao = SCREENSHOTS.evolucao;

  return (
    <section
      aria-labelledby="destaque-ia-title"
      // Solid brand/50 surface — intentionally no gradient / glow / blur (DS rule).
      className="bg-brand-50 py-16 md:py-24"
    >
      <Container className="flex flex-col items-center gap-10">
        <div className="flex max-w-3xl flex-col items-center gap-4 text-center">
          <h2 id="destaque-ia-title" className="text-display-md text-text-primary text-balance">
            {AI_HIGHLIGHT.title}
          </h2>
          <p className="text-lead text-text-secondary text-pretty">{AI_HIGHLIGHT.subtitle}</p>
        </div>

        {/* Antes / depois comparison. */}
        <div className="grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-2">
          {/* Antes: empty evolution editor mockup (CSS only — no screenshot). */}
          <figure className="flex flex-col gap-3">
            <div
              aria-hidden="true"
              className="bg-surface border-border flex h-full min-h-56 flex-col gap-3 rounded-xl border p-5"
            >
              <div className="bg-surface-muted h-3 w-2/5 rounded" />
              <div className="bg-border-subtle mt-1 h-px w-full" />
              <div className="text-text-tertiary flex items-center gap-1 text-sm">
                <span>Escreva a evolução da sessão…</span>
                <span className="bg-text-tertiary inline-block h-4 w-px animate-pulse" />
              </div>
            </div>
            <figcaption className="text-text-secondary text-center text-sm font-medium">
              {AI_HIGHLIGHT.beforeLabel}
            </figcaption>
          </figure>

          {/* Depois: real AI-filled evolução screenshot. */}
          <figure className="flex flex-col gap-3">
            <div className="border-border bg-surface overflow-hidden rounded-xl border">
              <Image
                src={evolucao.src}
                alt={evolucao.alt}
                width={evolucao.width}
                height={evolucao.height}
                loading="lazy"
                sizes="(max-width: 768px) 100vw, 480px"
                className="h-auto w-full"
              />
            </div>
            <figcaption className="text-text-primary text-center text-sm font-semibold">
              {AI_HIGHLIGHT.afterLabel}
            </figcaption>
          </figure>
        </div>

        {/* Four trust / safety guarantees. */}
        <ul className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
          {AI_HIGHLIGHT.trustItems.map((item) => (
            <li key={item} className="flex items-start gap-3">
              <CheckCircle2 aria-hidden="true" className="text-brand-700 mt-0.5 size-5 shrink-0" />
              <span className="text-text-secondary text-pretty">{item}</span>
            </li>
          ))}
        </ul>

        <SignupCta size="lg">{AI_HIGHLIGHT.cta.label}</SignupCta>
      </Container>
    </section>
  );
}

DestaqueIa.displayName = 'DestaqueIa';
