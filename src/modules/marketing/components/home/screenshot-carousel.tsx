'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * ScreenshotCarousel — reusable, accessible, hand-rolled carousel (client leaf).
 *
 * Design decision D3: we deliberately avoid a carousel library because the
 * requirements fight the typical library defaults — NO auto-play, a mandatory
 * no-JS static-first fallback, full keyboard + ARIA, touch swipe, and a respect
 * for `prefers-reduced-motion`. A generic library would have to be wrestled into
 * all of those; a small custom component is simpler and fully under our control.
 *
 * Behavior:
 *   - SSR renders the FIRST slide visible and every other slide hidden, so with
 *     JavaScript disabled the consumer (e.g. the hero) still shows one usable,
 *     static screenshot with no broken controls (the controls are wrapped in a
 *     `<div hidden>` until client JS reveals them after hydration).
 *   - Lateral arrows (≥44px, circular wrap) move slides; position dots below
 *     jump to a slide (active dot is a `brand/600` pill). Arrow keys move slides
 *     when focus is within the carousel. Touch swipe moves slides on mobile.
 *   - NO auto-play: there is no timer/interval anywhere in this component.
 *   - ARIA: role="region" + aria-roledescription="carousel" on the container;
 *     each slide is role="group" + aria-roledescription="slide" +
 *     aria-label="N de M"; the current slide is marked aria-hidden on the others.
 *
 * This is a leaf Client Component: it carries no PII and no secrets — only the
 * presentational slide data passed in by a server component.
 */

/** A single, self-contained carousel slide. Kept decoupled from the homepage
 *  content constants so the carousel is reusable elsewhere: the consumer
 *  resolves its own data (e.g. `HERO_CAROUSEL_SLIDES` + `SCREENSHOTS`) into this
 *  shape and passes it in. */
export interface CarouselSlide {
  /** Stable identifier — used as the React key and the slide's element id base. */
  readonly id: string;
  /** Image source (a `public/`-served WebP path). */
  readonly src: string;
  /** Descriptive pt-BR alt text for the screenshot. */
  readonly alt: string;
  /** One-line caption shown under the frame. */
  readonly caption: string;
  /** Intrinsic width in px (reserves the box so CLS stays < 0.1). */
  readonly width: number;
  /** Intrinsic height in px. */
  readonly height: number;
}

export interface ScreenshotCarouselProps {
  /** The slides to display (the spec calls for 4–6 real-system screenshots). */
  readonly slides: ReadonlyArray<CarouselSlide>;
  /** Accessible label for the carousel region (e.g. "Telas do sistema"). */
  readonly label: string;
  /** Optional extra classes for the outer region. */
  readonly className?: string;
}

const SWIPE_THRESHOLD_PX = 40;

/**
 * The interactive screenshot carousel. Auto-play is intentionally absent.
 */
export function ScreenshotCarousel({
  slides,
  label,
  className,
}: ScreenshotCarouselProps): React.JSX.Element | null {
  const [current, setCurrent] = React.useState(0);
  // `hydrated` gates the interactive controls: they stay inside a `hidden`
  // wrapper during SSR / before hydration so a no-JS visitor never sees broken
  // arrows or dots — only the static first slide. After hydration we reveal them.
  const [hydrated, setHydrated] = React.useState(false);
  const baseId = React.useId();
  const touchStartX = React.useRef<number | null>(null);

  React.useEffect(() => {
    // Deferred to the next frame so it is not a synchronous setState inside the
    // effect body (React Compiler `set-state-in-effect` rule) — same pattern as
    // `signup-cta.tsx`.
    const id = requestAnimationFrame(() => setHydrated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const count = slides.length;

  const goTo = React.useCallback(
    (index: number) => {
      if (count === 0) {
        return;
      }
      // Circular wrap in both directions.
      const next = ((index % count) + count) % count;
      setCurrent(next);
    },
    [count],
  );

  const goPrev = React.useCallback(() => goTo(current - 1), [current, goTo]);
  const goNext = React.useCallback(() => goTo(current + 1), [current, goTo]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    },
    [goPrev, goNext],
  );

  const onTouchStart = React.useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }, []);

  const onTouchEnd = React.useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const start = touchStartX.current;
      touchStartX.current = null;
      if (start === null) {
        return;
      }
      const end = event.changedTouches[0]?.clientX ?? start;
      const delta = end - start;
      if (Math.abs(delta) < SWIPE_THRESHOLD_PX) {
        return;
      }
      // Swipe left (delta < 0) advances; swipe right goes back.
      if (delta < 0) {
        goNext();
      } else {
        goPrev();
      }
    },
    [goNext, goPrev],
  );

  if (count === 0) {
    return null;
  }

  return (
    // role=region + aria-roledescription=carousel: announces the widget kind.
    // onKeyDown handles Arrow keys when focus is anywhere within the region.
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      className={cn('flex flex-col gap-4', className)}
      onKeyDown={onKeyDown}
    >
      {/* Product-window frame: a browser/app-window chrome around the live
          screenshot. The traffic-light dots are decorative. */}
      <div className="border-border-subtle bg-surface overflow-hidden rounded-xl border shadow-md">
        <div className="border-border-subtle bg-surface-muted flex h-8 items-center gap-2 border-b px-4">
          <span aria-hidden="true" className="bg-border-strong size-3 rounded-full" />
          <span aria-hidden="true" className="bg-border-strong size-3 rounded-full" />
          <span aria-hidden="true" className="bg-border-strong size-3 rounded-full" />
        </div>

        {/* The live region of slides. Each slide is a role=group; only the
            current one is shown (all others are `hidden`, which also removes
            them from the a11y tree and tab order). */}
        <div className="relative" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {slides.map((slide, index) => {
            const isCurrent = index === current;
            return (
              <div
                key={slide.id}
                id={`${baseId}-slide-${slide.id}`}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} de ${count}`}
                aria-hidden={isCurrent ? undefined : true}
                hidden={!isCurrent}
                data-active={isCurrent ? 'true' : 'false'}
              >
                <Image
                  src={slide.src}
                  alt={slide.alt}
                  width={slide.width}
                  height={slide.height}
                  // The first slide is the LCP candidate (it is what the no-JS
                  // and initial render show), so it loads eagerly; every other,
                  // off-screen slide is lazy to keep the initial payload small.
                  loading={index === 0 ? 'eager' : 'lazy'}
                  priority={index === 0}
                  sizes="(max-width: 768px) 100vw, 720px"
                  className="h-auto w-full"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Caption for the current slide. aria-live=polite announces caption
          changes to screen readers as slides change. */}
      <p aria-live="polite" className="text-text-secondary text-center text-sm">
        {slides[current]?.caption}
      </p>

      {/* Interactive controls: hidden until hydrated so no-JS shows only the
          static first slide with no broken arrows/dots. */}
      <div hidden={!hydrated} className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={goPrev}
          aria-label="Slide anterior"
          className={cn(
            'border-border-subtle bg-surface text-text-primary inline-flex size-11 items-center justify-center rounded-full border shadow-xs',
            'focus-visible:shadow-focus outline-none',
            'hover:bg-surface-muted transition-colors',
          )}
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>

        {/* Position dots — active dot is a brand/600 pill. */}
        <div role="tablist" aria-label="Selecionar slide" className="flex items-center gap-2">
          {slides.map((slide, index) => {
            const isCurrent = index === current;
            return (
              <button
                key={slide.id}
                type="button"
                role="tab"
                aria-label={`Ir para o slide ${index + 1} de ${count}`}
                aria-selected={isCurrent}
                aria-controls={`${baseId}-slide-${slide.id}`}
                onClick={() => goTo(index)}
                data-active={isCurrent ? 'true' : 'false'}
                className={cn(
                  'focus-visible:shadow-focus h-2 rounded-full transition-all outline-none',
                  isCurrent ? 'bg-brand-600 w-5' : 'bg-border-strong hover:bg-border-strong w-2',
                )}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={goNext}
          aria-label="Próximo slide"
          className={cn(
            'border-border-subtle bg-surface text-text-primary inline-flex size-11 items-center justify-center rounded-full border shadow-xs',
            'focus-visible:shadow-focus outline-none',
            'hover:bg-surface-muted transition-colors',
          )}
        >
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>
    </div>
  );
}

ScreenshotCarousel.displayName = 'ScreenshotCarousel';
