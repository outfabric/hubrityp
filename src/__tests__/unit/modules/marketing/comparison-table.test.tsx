import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ComparisonTable } from '@/modules/marketing/components/pricing/comparison-table';
import { FEATURE_KEYS, getComparisonMatrix, PLANS } from '@/modules/marketing/lib/plans';
import { PRICING_PAGE } from '@/modules/marketing/lib/pricing-content';

/*
 * Comparison table (the `/precos` expandable feature matrix) — data-driven and
 * a11y-correct (design decision D2 / WCAG).
 *
 * Behavioral contracts:
 *   - Renders one row per RF-14.27 feature (9 rows) and one column per plan,
 *     all derived from the central config via `getComparisonMatrix()` — the test
 *     derives its expectations from the same source so the two cannot drift.
 *   - The Essencial ⊂ Avançado invariant is observable in the RENDERED table:
 *     for every feature, if Essencial includes it then Avançado does too, and
 *     the only rows where they differ are WhatsApp reminders + AI notes.
 *   - The ✓/— marks carry accessible labels ("incluído" / "não incluído"), never
 *     bare icons.
 *   - Expandable: after hydration the table collapses to a preview with a
 *     toggle; expanding reveals the remaining rows (including the two
 *     Avançado-exclusive ones).
 */

/** The two rows where Avançado differs from Essencial (per the config invariant). */
const AVANCADO_EXCLUSIVE_KEYS = ['lembretes_whatsapp', 'transcricao_ia'] as const;

/** Whether a feature is included in a plan, read from the source matrix. */
function isIncluded(featureKey: (typeof FEATURE_KEYS)[number], planSlug: string): boolean {
  const plan = PLANS.find((p) => p.slug === planSlug);
  return plan?.features.find((f) => f.key === featureKey)?.included ?? false;
}

describe('ComparisonTable — data-driven matrix', () => {
  it('renders one row per RF-14.27 feature (9 rows) inside a real <table>', async () => {
    const user = userEvent.setup();
    render(<ComparisonTable />);

    const matrix = getComparisonMatrix();
    expect(matrix).toHaveLength(FEATURE_KEYS.length);
    expect(FEATURE_KEYS).toHaveLength(9);

    // Expand so every row is in the accessibility tree regardless of the
    // collapsed-preview state (which depends on hydration timing).
    await user.click(await screen.findByRole('button', { name: /ver todos os recursos/i }));

    const table = screen.getByRole('table');
    // All 9 feature rows are present as `<th scope="row">` row headers. Scope to
    // the table so the mobile stacked-block copy of the labels does not
    // double-count.
    const tbody = table.querySelector('tbody');
    expect(tbody?.querySelectorAll('tr')).toHaveLength(FEATURE_KEYS.length);
    for (const row of matrix) {
      expect(within(table).getByRole('rowheader', { name: row.label })).toBeInTheDocument();
    }
  });

  it('renders one column header per plan with <th scope="col">', () => {
    render(<ComparisonTable />);

    const table = screen.getByRole('table');
    // The feature column header + one per plan.
    expect(within(table).getByRole('columnheader', { name: 'Funcionalidade' })).toBeInTheDocument();
    for (const plan of PLANS) {
      expect(within(table).getByRole('columnheader', { name: plan.name })).toBeInTheDocument();
    }
  });

  it('marks ✓/— with accessible labels, never bare icons', async () => {
    const user = userEvent.setup();
    render(<ComparisonTable />);

    // Expand first so every row (incl. the two excluded ones) is in the table.
    await user.click(await screen.findByRole('button', { name: /ver todos os recursos/i }));

    const table = screen.getByRole('table');

    // Every cell's inclusion state is announced. There is at least one "incluído"
    // and — because two Avançado-exclusive rows are excluded for Essencial — at
    // least one "não incluído".
    expect(within(table).getAllByText('incluído').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('não incluído').length).toBeGreaterThan(0);

    // The count of "não incluído" in the table equals the number of excluded
    // (feature, plan) pairs across the whole matrix.
    const expectedNotIncluded = getComparisonMatrix().reduce((acc, row) => {
      const excludedForRow = PLANS.filter((plan) => row.included.get(plan.slug) === false).length;
      return acc + excludedForRow;
    }, 0);
    expect(within(table).getAllByText('não incluído')).toHaveLength(expectedNotIncluded);
  });

  it('observes the Essencial ⊂ Avançado invariant in the rendered table', async () => {
    const user = userEvent.setup();
    render(<ComparisonTable />);
    await user.click(await screen.findByRole('button', { name: /ver todos os recursos/i }));

    const table = screen.getByRole('table');

    for (const featureKey of FEATURE_KEYS) {
      const label = getComparisonMatrix().find((r) => r.key === featureKey)!.label;
      const rowHeader = within(table).getByRole('rowheader', { name: label });
      const row = rowHeader.closest('tr');
      expect(row).not.toBeNull();

      const essencialIncluded = isIncluded(featureKey, 'essencial');
      const avancadoIncluded = isIncluded(featureKey, 'avancado');

      // Strict-superset invariant: Essencial included ⇒ Avançado included.
      if (essencialIncluded) {
        expect(avancadoIncluded).toBe(true);
      }

      // The differing rows are exactly the two Avançado-exclusive features.
      const differs = essencialIncluded !== avancadoIncluded;
      if (differs) {
        expect(AVANCADO_EXCLUSIVE_KEYS).toContain(featureKey);
      }
    }

    // And the two exclusive rows do differ (✓ for Avançado, — for Essencial).
    for (const featureKey of AVANCADO_EXCLUSIVE_KEYS) {
      expect(isIncluded(featureKey, 'essencial')).toBe(false);
      expect(isIncluded(featureKey, 'avancado')).toBe(true);
    }
  });

  it('tints the highlighted (badged) plan column with the brand tint', () => {
    render(<ComparisonTable />);
    const table = screen.getByRole('table');

    const badged = PLANS.find((plan) => plan.badge);
    expect(badged).toBeDefined();
    const header = within(table).getByRole('columnheader', { name: badged!.name });
    expect(header.className).toContain('bg-brand-50');
  });
});

describe('ComparisonTable — expandable behavior', () => {
  it('collapses to a preview after hydration and hides the trailing rows', async () => {
    render(<ComparisonTable />);

    const table = screen.getByRole('table');

    // The two Avançado-exclusive rows are the trailing rows; while collapsed they
    // are present in the DOM but hidden (their row carries `hidden`).
    await screen.findByRole('button', { name: /ver todos os recursos/i });

    for (const featureKey of AVANCADO_EXCLUSIVE_KEYS) {
      const label = getComparisonMatrix().find((r) => r.key === featureKey)!.label;
      // `getByRole` excludes elements hidden via the `hidden` attribute, so the
      // collapsed trailing rows must NOT be found by their accessible role.
      expect(within(table).queryByRole('rowheader', { name: label })).not.toBeInTheDocument();
    }
  });

  it('reveals all rows when expanded and toggles the control label/state', async () => {
    const user = userEvent.setup();
    render(<ComparisonTable />);

    const toggle = await screen.findByRole('button', { name: /ver todos os recursos/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName(/ver menos/i);

    const table = screen.getByRole('table');
    // After expanding, the previously hidden rows are now reachable.
    for (const featureKey of AVANCADO_EXCLUSIVE_KEYS) {
      const label = getComparisonMatrix().find((r) => r.key === featureKey)!.label;
      expect(within(table).getByRole('rowheader', { name: label })).toBeInTheDocument();
    }

    // Collapsing again hides them.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (const featureKey of AVANCADO_EXCLUSIVE_KEYS) {
      const label = getComparisonMatrix().find((r) => r.key === featureKey)!.label;
      expect(within(table).queryByRole('rowheader', { name: label })).not.toBeInTheDocument();
    }
  });

  it('uses the comparison heading from the content config', () => {
    render(<ComparisonTable />);
    expect(screen.getByRole('heading', { name: PRICING_PAGE.comparisonTitle })).toBeInTheDocument();
  });
});
