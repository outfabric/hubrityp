'use client';

// Solução timeline — the value-cycle section of the public homepage (`/`).
// --------------------------------------------------------------------------
// Presents the six connected steps that take a patient from "cadastrado" to
// "prontuário salvo, CFP cumprido", followed by the closer line. The data is
// owned by `SOLUTION_STEPS` / `SOLUTION_CLOSER` (plus `SOLUTION_TITLE` /
// `SOLUTION_SUBTITLE`) in `home-content.ts`; the unit test asserts the count,
// order, per-breakpoint markers/numbering and the closer-visibility rule.
//
// Layout (Figma desktop `116:2` / mobile `135:42`):
//   - Desktop (`md` and up): a horizontal 6-column flow. Each step carries an
//     uppercase "PASSO 0N" marker (`Label/caption-upper`, 12/16, ls 6), the icon
//     chip (`brand/700` glyph in a `brand/50` chip, `radius-lg`), the step title
//     (`desktop` copy) and a one-line explanation. The section heading renders in
//     `Display/lg` with the `Lead` subtitle below it, and the closer line shows.
//   - Mobile (below `md`): a vertical stack. Each step is inline-numbered ("N.")
//     instead of the "PASSO" marker, uses the condensed `mobile` title/copy, the
//     condensed section heading, NO subtitle and NO closer line.
//
// Each step renders its Lucide icon (`brand/700`) inside a `brand/50` chip.
//
// Design decision D5 — scroll fade-in, reduced-motion-guarded:
//   The fade-in is a progressive enhancement, never a gate on visibility. The
//   DEFAULT (server-rendered, no-JS, reduced-motion) state is FULL OPACITY: the
//   content is always readable. Only when JS runs AND the user has NOT requested
//   reduced motion do we (a) add the "hidden-until-seen" state (opacity 0 +
//   slight translate) and (b) wire an IntersectionObserver that reveals each
//   step as it scrolls into view. If JS fails, the observer is unsupported, or
//   motion is reduced, every step stays at opacity 1 — never stuck invisible.
//
// This is a leaf Client Component: it carries no PII and no secrets, only the
// static presentational content from the content layer.

import {
  CalendarPlus,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Video,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import {
  SOLUTION_CLOSER,
  SOLUTION_STEPS,
  SOLUTION_SUBTITLE,
  SOLUTION_TITLE,
  type LucideIconName,
} from '@/modules/marketing/lib/home-content';
import { cn } from '@/shared/lib/utils';

/**
 * Static name → component map for the icons the solution steps reference. Kept
 * explicit (not a dynamic import) because the set is small, known at build time,
 * and statically importing keeps the icons in the same chunk with no loading
 * state — there is no user input here, so the map cannot be abused.
 */
const STEP_ICONS = {
  UserPlus,
  CalendarPlus,
  MessageCircle,
  Video,
  Sparkles,
  ShieldCheck,
} satisfies Record<LucideIconName, LucideIcon>;

function resolveIcon(name: LucideIconName): LucideIcon {
  // Fall back to ShieldCheck so an unmapped icon name can never crash the page;
  // the unit test pins the content layer to the mapped names.
  return STEP_ICONS[name as keyof typeof STEP_ICONS] ?? ShieldCheck;
}

/**
 * Wires the reduced-motion-guarded scroll fade-in.
 *
 * Returns `true` when the fade-in is active (JS ran AND motion is allowed), so
 * the rendered steps can opt into the "hidden-until-seen" state. The default is
 * `false`, which means the steps render at full opacity (the safe state).
 */
function useScrollFadeIn(containerRef: React.RefObject<HTMLElement | null>): boolean {
  const [fadeInActive, setFadeInActive] = React.useState(false);

  React.useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // If motion is reduced or IntersectionObserver is unavailable, do nothing:
    // the steps stay at full opacity (the CSS default). Never hide content we
    // cannot reveal.
    if (reduceMotion || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const root = containerRef.current;
    if (root === null) {
      return;
    }

    // Activate the hidden-until-seen state only now that we know we can reveal.
    setFadeInActive(true);

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-fade-item]'));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-fade-visible', 'true');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );

    for (const item of items) {
      observer.observe(item);
    }

    return () => observer.disconnect();
  }, [containerRef]);

  return fadeInActive;
}

/**
 * The homepage "solução" value-cycle timeline: six connected steps plus the
 * closer. Horizontal on desktop, vertical on mobile.
 */
export function SolucaoTimeline(): React.JSX.Element {
  const listRef = React.useRef<HTMLOListElement | null>(null);
  const fadeInActive = useScrollFadeIn(listRef);

  return (
    <section aria-labelledby="solucao-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-4">
          {/* Section heading: condensed `mobile` string below `md`, full
              `desktop` string from `md` up. The hidden variant is `aria-hidden`
              so assistive tech reads the title exactly once. */}
          <h2
            id="solucao-title"
            className="text-display-lg text-text-primary max-w-3xl text-balance"
          >
            <span className="md:hidden" aria-hidden="true">
              {SOLUTION_TITLE.mobile}
            </span>
            <span className="hidden md:inline">{SOLUTION_TITLE.desktop}</span>
          </h2>

          {/* Lead subtitle — desktop only (Figma drops it on mobile). */}
          <p className="text-lead text-text-secondary hidden max-w-2xl text-pretty md:block">
            {SOLUTION_SUBTITLE}
          </p>
        </div>

        {/* Horizontal 6-column flow on md+; vertical stack on mobile. The
            connector is an absolutely-positioned line on each item except the
            last. */}
        <ol
          ref={listRef}
          className="flex w-full max-w-6xl flex-col gap-8 md:grid md:grid-cols-6 md:gap-0"
        >
          {SOLUTION_STEPS.map((step, index) => {
            const Icon = resolveIcon(step.icon);
            const isLast = index === SOLUTION_STEPS.length - 1;
            // Desktop marker "PASSO 01" … "PASSO 06" (zero-padded for orders 1–9).
            const marker = `Passo ${String(step.order).padStart(2, '0')}`;

            return (
              <li
                key={step.order}
                data-fade-item
                data-fade-visible={fadeInActive ? 'false' : undefined}
                className={cn(
                  'relative flex items-start gap-4 md:flex-col md:items-center md:gap-3 md:px-2 md:text-center',
                  // Fade-in is purely additive. Default = full opacity. When the
                  // enhancement is active each item starts hidden+offset and the
                  // observer flips data-fade-visible to slide it in. The
                  // arbitrary selectors read the data attribute so the same
                  // element is the source of truth for both states.
                  'motion-safe:transition-all motion-safe:duration-500 motion-safe:ease-out',
                  'data-[fade-visible=false]:translate-y-4 data-[fade-visible=false]:opacity-0',
                  'data-[fade-visible=true]:translate-y-0 data-[fade-visible=true]:opacity-100',
                )}
              >
                {/* Mobile vertical connector: a line down the chip column, drawn
                    for every step except the last. */}
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className="bg-border absolute top-12 left-[1.375rem] h-[calc(100%-1rem)] w-px md:hidden"
                  />
                ) : null}

                {/* Desktop horizontal connector: a line from this chip toward the
                    next, drawn for every step except the last. */}
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className="bg-border absolute top-[1.375rem] left-1/2 hidden h-px w-full md:block"
                  />
                ) : null}

                {/* Step chip: brand/50 background, brand/700 icon, radius-lg.
                    Stays above the connector lines. */}
                <span className="bg-brand-50 text-brand-700 relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-lg">
                  <Icon aria-hidden="true" className="size-5" />
                </span>

                <div className="flex flex-col gap-1 md:items-center">
                  {/* Desktop-only "PASSO 0N" marker (Label/caption-upper). */}
                  <span className="text-text-tertiary hidden text-xs font-medium tracking-[0.06em] uppercase md:block">
                    {marker}
                  </span>

                  {/* Step title: inline-numbered "N." on mobile, condensed copy
                      below `md` and the full `desktop` copy from `md` up. The
                      hidden variant is `aria-hidden` to avoid double reading. */}
                  <h3 className="text-text-primary text-base font-semibold text-balance">
                    <span className="md:hidden" aria-hidden="true">
                      {step.order}. {step.title.mobile ?? step.title.desktop}
                    </span>
                    <span className="hidden md:inline">{step.title.desktop}</span>
                  </h3>

                  {/* One-line explanation: condensed below `md`, full from `md` up. */}
                  <p className="text-text-secondary max-w-[16rem] text-sm text-pretty">
                    <span className="md:hidden" aria-hidden="true">
                      {step.description.mobile ?? step.description.desktop}
                    </span>
                    <span className="hidden md:inline">{step.description.desktop}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Closing line — desktop only (Figma drops it on mobile). */}
        <p className="text-lead text-text-primary hidden max-w-2xl font-medium text-pretty md:block">
          {SOLUTION_CLOSER}
        </p>
      </Container>
    </section>
  );
}

SolucaoTimeline.displayName = 'SolucaoTimeline';
