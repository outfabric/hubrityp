'use client';

// Comparison table — the expandable 9-row × 2-plan feature matrix of the
// `/precos` page.
// --------------------------------------------------------------------------
// Data-driven (design decision D2): every row comes from `getComparisonMatrix()`
// (which is itself derived from the central `PLANS` config), so the table can
// never disagree with the plan cards or the homepage summary. Nothing here is
// hand-written content beyond the SR labels and the column headers — even those
// plan names come from `PLANS`.
//
// Accessibility (D2 / WCAG): rendered as a REAL `<table>` with `<th scope>`
// headers (`scope="col"` for the plan columns, `scope="row"` for each feature
// label). The ✓/— marks are NOT bare icons: each carries an `.sr-only` label
// ("incluído" / "não incluído") so a screen-reader user hears the inclusion
// state, while sighted users see a `brand/700` check or a `border/strong` dash.
// The Avançado column is tinted `brand/50`.
//
// Expandable: with JS enabled, the table collapses to a preview of the first
// `PREVIEW_ROW_COUNT` rows and a "Ver todos os recursos" toggle reveals the
// rest (the two Avançado-exclusive rows — WhatsApp reminders + AI — live below
// the fold, so expanding is what surfaces the plan difference). The toggle is a
// real `<button>` with `aria-expanded` + `aria-controls`. With NO JS the full
// table renders expanded (graceful degradation) and the toggle is inert.
//
// Mobile: at `< md` the `<table>` is hidden and the same data renders as stacked
// per-plan blocks (so there is no horizontal overflow at 375px), keeping list
// semantics. At `>= md` the stacked blocks are hidden and the table is shown.
//
// Leaf Client Component: presentational only — no PII, no secrets, nothing
// fetched. It needs `'use client'` solely for the expand/collapse interaction.

import { Check } from 'lucide-react';
import * as React from 'react';

import { getComparisonMatrix, PLANS, type ComparisonRow } from '@/modules/marketing/lib/plans';
import { PRICING_PAGE } from '@/modules/marketing/lib/pricing-content';
import { cn } from '@/shared/lib/utils';

/** Screen-reader labels for the inclusion marks (D2: ✓/— are never bare icons). */
const INCLUDED_LABEL = 'incluído';
const NOT_INCLUDED_LABEL = 'não incluído';

/** Accessible label for the disclosure toggle, by state. */
const EXPAND_LABEL = 'Ver todos os recursos';
const COLLAPSE_LABEL = 'Ver menos';

/**
 * How many rows are visible while collapsed. Kept below the total (9) so the two
 * Avançado-exclusive rows (WhatsApp reminders + AI notes, rows 8 and 9) are the
 * payoff of expanding — see the E2E flow that expands the table to reveal them.
 */
const PREVIEW_ROW_COUNT = 6;

const COMPARISON_TABLE_BODY_ID = 'comparison-table-rows';

/**
 * The inclusion mark for a single cell: a `brand/700` check when included or a
 * `border/strong` dash when not, each paired with an `.sr-only` label so the
 * state is announced to assistive tech (the icon/dash itself is `aria-hidden`).
 */
function InclusionMark({ included }: { readonly included: boolean }): React.JSX.Element {
  if (included) {
    return (
      <>
        <Check aria-hidden="true" className="text-brand-700 size-4 shrink-0" />
        <span className="sr-only">{INCLUDED_LABEL}</span>
      </>
    );
  }
  return (
    <>
      {/* The "not included" dash: a short horizontal bar in `border/strong`,
          mirroring the Figma frame. Decorative — the state is in the SR label. */}
      <span aria-hidden="true" className="bg-border-strong h-0.5 w-3 shrink-0 rounded-full" />
      <span className="sr-only">{NOT_INCLUDED_LABEL}</span>
    </>
  );
}

/**
 * The desktop/tablet (`>= md`) real `<table>`. Rows beyond the preview are
 * collapsed via the `hidden` attribute (driven by `expanded`); with no JS,
 * `expanded` is forced true so the full table renders.
 */
function ComparisonTableGrid({
  rows,
  expanded,
}: {
  readonly rows: ReadonlyArray<ComparisonRow>;
  readonly expanded: boolean;
}): React.JSX.Element {
  return (
    <table className="bg-surface border-border w-full border-collapse overflow-hidden rounded-2xl border text-left shadow-xs">
      <caption className="sr-only">{PRICING_PAGE.comparisonTitle}</caption>
      <thead>
        <tr className="bg-surface-muted">
          <th
            scope="col"
            className="text-text-secondary px-4 py-3 text-xs font-medium tracking-wider uppercase"
          >
            Funcionalidade
          </th>
          {PLANS.map((plan) => {
            // The "highlighted" (badged) plan gets the brand tint, matching the
            // plan card emphasis and the Figma Avançado column.
            const highlighted = Boolean(plan.badge);
            return (
              <th
                key={plan.slug}
                scope="col"
                className={cn(
                  'w-[140px] px-4 py-3 text-center text-xs font-medium tracking-wider uppercase',
                  highlighted ? 'bg-brand-50 text-brand-700' : 'text-text-secondary',
                )}
              >
                {plan.name}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody id={COMPARISON_TABLE_BODY_ID}>
        {rows.map((row, index) => {
          // Collapsed: only the first PREVIEW_ROW_COUNT rows are visible. The
          // `hidden` attribute keeps the rows in the accessibility tree's DOM
          // but removes them from layout/AT until expanded.
          const hiddenWhileCollapsed = !expanded && index >= PREVIEW_ROW_COUNT;
          return (
            <tr
              key={row.key}
              hidden={hiddenWhileCollapsed}
              className="border-border-subtle border-t first:border-t-0"
            >
              <th
                scope="row"
                className="text-text-primary px-4 py-4 text-left text-[15px] leading-[22px] font-normal"
              >
                {row.label}
              </th>
              {PLANS.map((plan) => {
                const included = row.included.get(plan.slug) ?? false;
                const highlighted = Boolean(plan.badge);
                return (
                  <td
                    key={plan.slug}
                    className={cn(
                      'px-4 py-3 text-center align-middle',
                      highlighted && 'bg-brand-50',
                    )}
                  >
                    <span className="inline-flex items-center justify-center">
                      <InclusionMark included={included} />
                    </span>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The mobile (`< md`) stacked layout: one block per plan, each listing every
 * feature with its inclusion mark. Same data as the table, no horizontal
 * overflow at 375px. Uses list semantics rather than a table so a narrow
 * viewport never needs to scroll sideways.
 */
function ComparisonStackedBlocks({
  rows,
  expanded,
}: {
  readonly rows: ReadonlyArray<ComparisonRow>;
  readonly expanded: boolean;
}): React.JSX.Element {
  const visibleRows = expanded ? rows : rows.slice(0, PREVIEW_ROW_COUNT);
  return (
    <div className="flex flex-col gap-6">
      {PLANS.map((plan) => {
        const highlighted = Boolean(plan.badge);
        return (
          <section
            key={plan.slug}
            aria-label={plan.name}
            className={cn(
              'bg-surface flex flex-col gap-3 rounded-2xl border p-5 shadow-xs',
              highlighted ? 'border-brand-400 border-2' : 'border-border',
            )}
          >
            <h3 className="text-text-primary text-lg font-semibold">{plan.name}</h3>
            <ul className="flex flex-col gap-2.5">
              {visibleRows.map((row) => {
                const included = row.included.get(plan.slug) ?? false;
                return (
                  <li key={row.key} className="flex items-start justify-between gap-3">
                    <span className="text-text-primary text-sm">{row.label}</span>
                    <span className="mt-0.5 inline-flex shrink-0 items-center justify-center">
                      <InclusionMark included={included} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The `/precos` comparison-table section: an expandable, data-driven feature
 * matrix (9 RF-14.27 rows × the configured plans). Renders the desktop table and
 * the mobile stacked blocks from the SAME matrix, with a shared expand/collapse
 * control. When the config resolves to zero plans the matrix is empty and the
 * section renders nothing (the plan-cards section owns the empty-plans fallback).
 */
export function ComparisonTable(): React.JSX.Element | null {
  const rows = React.useMemo(() => getComparisonMatrix(), []);

  // `hydrated` gates the JS-only collapse. During SSR / before hydration the
  // full table is shown (no-JS graceful degradation); after hydration we collapse
  // to the preview and let the toggle expand it — mirroring the FAQ pattern.
  const [hydrated, setHydrated] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    // Deferred a frame so it is not a synchronous setState inside the effect body
    // (React Compiler `set-state-in-effect` rule) — same pattern as `faq.tsx`.
    const id = requestAnimationFrame(() => setHydrated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Nothing to compare when the config has no plans (or no feature rows): the
  // plan-cards section already shows the empty-plans fallback, so render nothing
  // here rather than an empty table.
  if (rows.length === 0) {
    return null;
  }

  // Before hydration: full table (no-JS fallback). After: collapsed unless the
  // user has expanded. When every row fits in the preview there is nothing to
  // toggle, so the disclosure control is omitted and the table stays full.
  const isCollapsible = hydrated && rows.length > PREVIEW_ROW_COUNT;
  const isExpanded = !isCollapsible || expanded;

  return (
    <section aria-labelledby="comparison-title" className="bg-background py-16 md:py-24">
      <div className="mx-auto flex w-full max-w-[55rem] flex-col items-center gap-7 px-4">
        <h2 id="comparison-title" className="text-display-md text-text-primary text-center">
          {PRICING_PAGE.comparisonTitle}
        </h2>

        {/* Desktop / tablet: the real table. Hidden below md. */}
        <div className="hidden w-full md:block">
          <ComparisonTableGrid rows={rows} expanded={isExpanded} />
        </div>

        {/* Mobile: stacked per-plan blocks. Hidden at md and up. */}
        <div className="w-full md:hidden">
          <ComparisonStackedBlocks rows={rows} expanded={isExpanded} />
        </div>

        {isCollapsible ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={COMPARISON_TABLE_BODY_ID}
            onClick={() => setExpanded((previous) => !previous)}
            className={cn(
              'text-brand-700 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium',
              'focus-visible:shadow-focus outline-none',
              'hover:underline',
            )}
          >
            {expanded ? COLLAPSE_LABEL : EXPAND_LABEL}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('size-4 shrink-0 transition-transform', expanded && 'rotate-180')}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : null}
      </div>
    </section>
  );
}

ComparisonTable.displayName = 'ComparisonTable';
