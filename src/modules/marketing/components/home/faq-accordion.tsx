'use client';

import * as React from 'react';

import { Container } from '@/modules/marketing/components/container';
import type { FaqEntry } from '@/modules/marketing/lib/home-content';
import { cn } from '@/shared/lib/utils';

/**
 * FaqAccordion — the shared, accessible `<details>/<summary>` accordion that backs
 * BOTH the homepage FAQ (`Faq`) and the pricing-page billing FAQ (`BillingFaq`).
 * --------------------------------------------------------------------------
 * Design decision D4: built on native `<details>/<summary>` disclosure elements
 * so the no-JS state (every answer readable) and baseline keyboard/ARIA support
 * come for free from the platform — no library, no custom focus management.
 *
 * No-JS fallback: SSR renders every `<details>` with the `open` attribute, so a
 * visitor without JavaScript sees ALL answers expanded and readable, and
 * exclusivity is simply not enforced (a graceful degradation, never a broken UI).
 *
 * Client enhancement (after hydration only):
 *   - collapses every item except the first, then
 *   - enforces EXCLUSIVE behavior — opening one item closes the previously open
 *     one (a single `toggle` listener per item closes its siblings), and
 *   - paints the open item with an active `brand/200` border so the expanded
 *     question is visually distinct.
 *
 * Leaf Client Component: it carries only presentational FAQ copy passed in by its
 * caller (homepage or pricing) — no PII, no secrets, nothing fetched.
 */
export interface FaqAccordionProps {
  /** The questions/answers to render — the content layer drives the count. */
  readonly entries: ReadonlyArray<FaqEntry>;
  /** Visible section heading (e.g. "Perguntas frequentes" or billing-specific). */
  readonly title: string;
  /** DOM id for the `<h2>`; the `<section>` is `aria-labelledby` this id. */
  readonly titleId: string;
  /**
   * Optional uppercase eyebrow shown ABOVE the title on DESKTOP ONLY
   * (`Label/caption-upper` 12/16 ls 6, `brand-700`, `hidden md:block`). The
   * homepage FAQ (Figma `125:2`) renders "PERGUNTAS FREQUENTES"; the mobile frame
   * (`138:2`) and the pricing-page billing FAQ omit it.
   */
  readonly eyebrow?: string;
}

/** A breakpoint-aware copy variant (the shared [[ResponsiveCopy]] shape). */
interface ResponsiveCopyLike {
  readonly desktop: string;
  readonly mobile?: string;
}

/**
 * Renders a [[ResponsiveCopy]] string: the `desktop` variant from the `md`
 * breakpoint up and the condensed `mobile` variant below it. When `mobile` is
 * absent the single `desktop` string renders at every width. The hidden variant
 * is `aria-hidden` so assistive tech reads each string exactly once.
 *
 * `desktopClassName` / `mobileClassName` carry the per-breakpoint typography
 * tokens (e.g. the homepage question label is `Body/lg` on desktop and
 * `Body/base`–`Heading/h4` on mobile).
 */
function ResponsiveText({
  copy,
  desktopClassName,
  mobileClassName,
}: {
  readonly copy: ResponsiveCopyLike;
  readonly desktopClassName?: string;
  readonly mobileClassName?: string;
}): React.JSX.Element {
  return (
    <>
      <span className={cn('hidden md:inline', desktopClassName)}>{copy.desktop}</span>
      <span
        className={cn('md:hidden', mobileClassName)}
        aria-hidden={copy.mobile ? 'true' : undefined}
      >
        {copy.mobile ?? copy.desktop}
      </span>
    </>
  );
}

export function FaqAccordion({
  entries,
  title,
  titleId,
  eyebrow,
}: FaqAccordionProps): React.JSX.Element {
  // `hydrated` gates the JS-only behavior. During SSR / before hydration every
  // item stays `open` (the no-JS fallback). After hydration we switch to the
  // exclusive accordion: only the active item is open.
  const [hydrated, setHydrated] = React.useState(false);
  // The index of the single open item once enhanced. `null` only matters before
  // hydration; after hydration the first item (index 0) is the initial open one.
  const [openIndex, setOpenIndex] = React.useState<number | null>(0);

  React.useEffect(() => {
    // Deferred to the next frame so it is not a synchronous setState inside the
    // effect body (React Compiler `set-state-in-effect` rule) — same pattern as
    // `screenshot-carousel.tsx` / `signup-cta.tsx`.
    const id = requestAnimationFrame(() => setHydrated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleToggle = React.useCallback(
    (index: number) => (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      // Only enforce exclusivity once enhanced; before hydration the native
      // all-open fallback is intentional.
      if (!hydrated) {
        return;
      }
      const nowOpen = event.currentTarget.open;
      setOpenIndex((previous) => {
        if (nowOpen) {
          // User expanded this item — it becomes the sole open one. (Closes the
          // previously open sibling via the controlled `open` prop.)
          return index;
        }
        // This item just collapsed. Ignore collapses that merely echo React's
        // own reconciliation (closing a sibling when another opens): only react
        // when it is the *currently* open item that the user closed, otherwise
        // the echoed `toggle` would wipe the state and close everything.
        return previous === index ? null : previous;
      });
    },
    [hydrated],
  );

  return (
    <section aria-labelledby={titleId} className="py-16 md:py-24">
      <Container className="flex flex-col items-center gap-10">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* Eyebrow: Label/caption-upper (12/16, ls 6) in brand-700, DESKTOP
              ONLY — the mobile FAQ frame shows the title with no eyebrow. */}
          {eyebrow ? (
            <p className="text-brand-700 hidden text-xs font-medium tracking-[0.06em] uppercase md:block">
              {eyebrow}
            </p>
          ) : null}

          <h2 id={titleId} className="text-display-md text-text-primary max-w-2xl">
            {title}
          </h2>
        </div>

        <ul className="flex w-full max-w-3xl flex-col gap-4">
          {entries.map((entry, index) => {
            // Before hydration: every item open (no-JS fallback). After: only
            // the single active item is open (exclusive accordion).
            const isOpen = hydrated ? openIndex === index : true;
            return (
              <li key={entry.question.desktop}>
                <details
                  open={isOpen}
                  onToggle={handleToggle(index)}
                  className={cn(
                    'bg-surface rounded-xl border transition-colors',
                    // Active item is highlighted with a brand/200 border so the
                    // expanded question stands out from the resting items.
                    isOpen ? 'border-brand-200' : 'border-border-subtle',
                  )}
                >
                  <summary
                    className={cn(
                      'text-text-primary flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 font-medium',
                      'focus-visible:shadow-focus outline-none',
                      'hover:bg-surface-muted transition-colors',
                    )}
                  >
                    {/* Question label: Body/lg (17/28) on desktop, Body/base
                        (15/22) ~ Heading/h4 below the md breakpoint. */}
                    <ResponsiveText
                      copy={entry.question}
                      desktopClassName="text-[17px]/[28px]"
                      mobileClassName="text-[15px]/[22px]"
                    />
                    {/* Decorative chevron: rotates when the item is open. The
                        open/closed state is already conveyed natively by
                        `<details>` to assistive tech, so this is aria-hidden. */}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={cn(
                        'text-text-secondary size-5 shrink-0 transition-transform',
                        isOpen && 'rotate-180',
                      )}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <p className="text-text-secondary px-5 pb-5 text-pretty">
                    <ResponsiveText copy={entry.answer} />
                  </p>
                </details>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

FaqAccordion.displayName = 'FaqAccordion';
