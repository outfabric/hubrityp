// Hero — the above-the-fold section of the public homepage (`/`).
// --------------------------------------------------------------------------
// This is a Server Component (presentational only — no client hooks, no PII,
// no secrets). It is a SINGLE CENTERED COLUMN (Figma `108:2` desktop / `133:14`
// mobile): a copy block centered at the top, with the screenshot carousel
// stacked BELOW it (never beside it). The copy block composes, in order:
//   - a `brand/50`-on-`brand/700` badge pill (`Label/caption`, `radius-full`),
//   - the headline — `Display/xl` (52/56) desktop, `Display/md` (32/40) mobile,
//   - the subheadline — `Lead` (20/30) desktop, `Body/lg` (17/28) mobile,
//     naming the MVP features + CFP/LGPD compliance,
//   - a primary, UTM-preserving CTA to `/signup` (the `SignupCta` client leaf)
//     and a secondary in-page CTA to `#funcionalidades`, both 48px tall —
//     side-by-side centered on desktop, full-width stacked on mobile,
//   - reassurance microcopy ("Sem cartão de crédito. Cancele quando quiser.").
//
// Headline, subheadline and microcopy are [[ResponsiveCopy]]: both the desktop
// and the condensed mobile string are rendered, and Tailwind toggles them by
// breakpoint (`hidden md:block` / `md:hidden`). The hidden variant is marked
// `aria-hidden` so assistive tech reads each string exactly once.
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
 *
 * Layout: a single centered column. The copy block (badge → headline →
 * subheadline → CTAs → microcopy) is centered at the top, and the screenshot
 * carousel is stacked directly below it (full content width — NOT beside the
 * copy). There is no two-column / `lg:flex-row` arrangement.
 */
export function Hero(): React.JSX.Element {
  return (
    <section aria-labelledby="hero-headline" className="py-12 md:py-20">
      <Container className="flex flex-col items-center gap-12 md:gap-16">
        {/* Copy block — centered at both breakpoints */}
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
          <span className="bg-brand-50 text-brand-700 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-medium">
            <span aria-hidden="true" className="bg-brand-700 size-1.5 rounded-full" />
            {HERO.badge}
          </span>

          {/* Headline: `Display/xl` desktop, condensed `Display/md` mobile.
              Both variants are present; the mobile (condensed) one is the hidden
              variant and is `aria-hidden` so assistive tech reads the canonical
              desktop string once. */}
          <h1 id="hero-headline" className="text-text-primary text-balance">
            <span className="text-display-xl hidden md:inline">{HERO.headline.desktop}</span>
            <span className="text-display-md md:hidden" aria-hidden="true">
              {HERO.headline.mobile}
            </span>
          </h1>

          {/* Subheadline: `Lead` desktop, condensed `Body/lg` (17/28) mobile. */}
          <p className="text-text-secondary text-pretty">
            <span className="text-lead hidden md:inline">{HERO.subheadline.desktop}</span>
            <span className="text-[17px]/[28px] md:hidden" aria-hidden="true">
              {HERO.subheadline.mobile}
            </span>
          </p>

          {/* CTAs: side-by-side centered on desktop (primary 244×48, secondary
              200×48), full-width stacked on mobile (343×48 each, primary above
              secondary). Both are 48px tall (`h-12`). */}
          <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
            <SignupCta
              size="lg"
              className="h-12 w-full text-center sm:w-[244px] sm:whitespace-nowrap"
            >
              {HERO.primaryCta.label}
            </SignupCta>

            <Button
              asChild
              variant="secondary"
              size="lg"
              className="h-12 w-full text-center sm:w-[200px] sm:whitespace-nowrap"
            >
              <Link href={HERO.secondaryCta.href}>{HERO.secondaryCta.label}</Link>
            </Button>
          </div>

          {/* Microcopy: `Body/sm`, condensed on mobile. */}
          <p className="text-text-tertiary text-sm">
            <span className="hidden md:inline">{HERO.microcopy.desktop}</span>
            <span className="md:hidden" aria-hidden="true">
              {HERO.microcopy.mobile}
            </span>
          </p>
        </div>

        {/* Screenshot carousel — full content width, BELOW the copy block
            (first slide = LCP). */}
        <div className="w-full max-w-[1160px]">
          <ScreenshotCarousel slides={HERO_SLIDES} label="Telas do sistema Hubrity" />
        </div>
      </Container>
    </section>
  );
}

Hero.displayName = 'Hero';
