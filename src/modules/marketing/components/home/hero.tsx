// Hero — the above-the-fold section of the public homepage (`/`).
// --------------------------------------------------------------------------
// This is a Server Component (presentational only — no client hooks, no PII,
// no secrets). It composes:
//   - a `brand/50`-on-`brand/700` badge,
//   - the `Display/xl` headline ("many tools → one clinical system"),
//   - the `Lead` subheadline naming the MVP features + CFP/LGPD compliance,
//   - a primary, UTM-preserving CTA to `/signup` (the `SignupCta` client leaf),
//   - a secondary in-page CTA to `#funcionalidades`,
//   - reassurance microcopy ("Sem cartão de crédito. Cancele quando quiser."),
//   - the embedded `ScreenshotCarousel` with the 5 ordered hero screenshots.
//
// The only client boundary is the `SignupCta` leaf (it reads
// `window.location.search` after hydration to fold in UTM params) and the
// `ScreenshotCarousel` leaf (interactive controls). Everything else renders on
// the server.
//
// LCP: the carousel's first slide is the Largest Contentful Paint candidate; the
// `ScreenshotCarousel` renders it with `priority`/`eager` so Next emits the
// preload hint for it. No additional preload wiring is needed here.

import Link from 'next/link';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import {
  ScreenshotCarousel,
  type CarouselSlide,
} from '@/modules/marketing/components/home/screenshot-carousel';
import { SignupCta } from '@/modules/marketing/components/signup-cta';
import { HERO, HERO_CAROUSEL_SLIDES, SCREENSHOTS } from '@/modules/marketing/lib/home-content';
import { Button } from '@/shared/ui/button';

// Resolve the ordered hero slide descriptors (content layer) into the
// presentational `CarouselSlide` shape the carousel consumes. Done at module
// scope so it is computed once, not per render.
const HERO_SLIDES: ReadonlyArray<CarouselSlide> = HERO_CAROUSEL_SLIDES.map((slide) => {
  const asset = SCREENSHOTS[slide.screenshot];
  return {
    id: slide.screenshot,
    src: asset.src,
    alt: asset.alt,
    caption: slide.caption,
    width: asset.width,
    height: asset.height,
  };
});

/**
 * The homepage hero. Presentational Server Component — the interactive bits
 * (UTM-preserving signup CTA, screenshot carousel) are isolated client leaves.
 */
export function Hero(): React.JSX.Element {
  return (
    <section aria-labelledby="hero-headline" className="py-12 md:py-20">
      <Container className="flex flex-col items-center gap-12 lg:flex-row lg:items-center lg:gap-16">
        {/* Copy column */}
        <div className="flex max-w-xl flex-col gap-6 text-center lg:text-left">
          <span className="bg-brand-50 text-brand-700 mx-auto inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium lg:mx-0">
            {HERO.badge}
          </span>

          <h1 id="hero-headline" className="text-display-xl text-text-primary text-balance">
            {HERO.headline}
          </h1>

          <p className="text-lead text-text-secondary text-pretty">{HERO.subheadline}</p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <SignupCta size="lg" className="w-full sm:w-auto">
              {HERO.primaryCta.label}
            </SignupCta>

            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
              <Link href={HERO.secondaryCta.href}>{HERO.secondaryCta.label}</Link>
            </Button>
          </div>

          <p className="text-text-tertiary text-sm">{HERO.microcopy}</p>
        </div>

        {/* Visual column — embedded screenshot carousel (first slide = LCP) */}
        <div className="w-full lg:flex-1">
          <ScreenshotCarousel slides={HERO_SLIDES} label="Telas do sistema Hubrity" />
        </div>
      </Container>
    </section>
  );
}

Hero.displayName = 'Hero';
