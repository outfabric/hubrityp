import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { BillingFaq } from '@/modules/marketing/components/pricing/billing-faq';
import { FEATURE_LABELS } from '@/modules/marketing/lib/plans';
import { BILLING_FAQ_ENTRIES } from '@/modules/marketing/lib/pricing-content';

/*
 * BillingFaq (pricing-page section) — DOM behavior.
 *
 * It reuses the SAME shared `<details>/<summary>` accordion the homepage FAQ
 * uses (no-JS all-open fallback + exclusive open after hydration), so the
 * behavioral contracts mirror `faq.test.tsx`, but the content is the billing
 * FAQ from `BILLING_FAQ_ENTRIES`.
 *
 * Section-4 spec contracts exercised here:
 *   - the billing FAQ shows the required topics (cobrança/monthly,
 *     cancelamento, fim do teste/downgrade, nota fiscal);
 *   - no-JS fallback: on the initial (pre-hydration) render EVERY item is open
 *     so all answers are readable without JavaScript;
 *   - exclusive accordion after hydration: opening one item closes the
 *     previously open one (only one open at a time);
 *   - nota fiscal is framed as provider-dependent/forward-looking copy and is
 *     NOT presented as an included plan feature (no comparison-matrix label,
 *     mentions the Asaas provider dependency).
 */

/** All <details> elements, in document order. */
function getDetails(container: HTMLElement): HTMLDetailsElement[] {
  return Array.from(container.querySelectorAll('details'));
}

/** Indices of the currently-open <details> elements. */
function openIndices(container: HTMLElement): number[] {
  return getDetails(container).flatMap((d, i) => (d.open ? [i] : []));
}

/**
 * Waits for the post-hydration enhancement to collapse the accordion down to a
 * single open item (the first). Before this, the component renders the no-JS
 * fallback with every item open.
 */
async function waitForExclusive(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(openIndices(container)).toEqual([0]);
  });
}

describe('BillingFaq — items + required topics', () => {
  it('renders one item per BILLING_FAQ_ENTRIES (content layer drives the count)', () => {
    const { container } = render(<BillingFaq />);
    const details = getDetails(container);
    // 3–5 billing questions per RF-14.26.
    expect(details.length).toBeGreaterThanOrEqual(3);
    expect(details.length).toBeLessThanOrEqual(5);
    expect(details).toHaveLength(BILLING_FAQ_ENTRIES.length);
  });

  it('renders every billing question and answer from the content layer', () => {
    render(<BillingFaq />);
    for (const entry of BILLING_FAQ_ENTRIES) {
      expect(screen.getByText(entry.question)).toBeInTheDocument();
      expect(screen.getByText(entry.answer)).toBeInTheDocument();
    }
  });

  it('shows the required billing topics: cobrança, cancelamento, downgrade, nota fiscal', () => {
    render(<BillingFaq />);
    // Aggregate the visible copy and assert each required topic surfaces.
    const haystack = BILLING_FAQ_ENTRIES.map((e) => `${e.question} ${e.answer}`.toLowerCase()).join(
      '\n',
    );
    expect(haystack).toContain('mensal'); // cobrança (monthly)
    expect(haystack).toContain('cancel'); // cancelamento
    expect(haystack).toContain('downgrade'); // fim do teste / downgrade
    expect(haystack).toContain('nota fiscal'); // nota fiscal
    // Each topic is also actually rendered to the DOM, not just present in data.
    expect(screen.getByText(/mensal/i)).toBeInTheDocument();
    expect(screen.getByText(/downgrade/i)).toBeInTheDocument();
  });
});

describe('BillingFaq — no-JS fallback', () => {
  it('renders every item open on the initial render so all answers are readable', () => {
    // The synchronous first render is the no-JS fallback: enhancement is gated
    // behind a requestAnimationFrame, so nothing has collapsed yet here.
    const { container } = render(<BillingFaq />);
    const details = getDetails(container);
    expect(details.every((d) => d.open)).toBe(true);
    for (const entry of BILLING_FAQ_ENTRIES) {
      expect(screen.getByText(entry.answer)).toBeInTheDocument();
    }
  });
});

describe('BillingFaq — exclusive accordion (after hydration)', () => {
  it('collapses to a single open item once enhanced', async () => {
    const { container } = render(<BillingFaq />);
    await waitForExclusive(container);
    expect(openIndices(container)).toEqual([0]);
  });

  it('closes the previously open item when another opens', async () => {
    const user = userEvent.setup();
    const { container } = render(<BillingFaq />);
    await waitForExclusive(container);

    const details = getDetails(container);
    // Open the second item via its summary; the first must then close.
    const secondSummary = within(details[1]!).getByText(BILLING_FAQ_ENTRIES[1]!.question, {
      selector: 'summary',
    });
    await user.click(secondSummary);

    await waitFor(() => {
      expect(openIndices(container)).toEqual([1]);
    });
  });

  it('marks the open item with the active brand/200 border and others as subtle', async () => {
    const { container } = render(<BillingFaq />);
    await waitForExclusive(container);

    const details = getDetails(container);
    expect(details[0]!.className).toContain('border-brand-200');
    expect(details[1]!.className).not.toContain('border-brand-200');
    expect(details[1]!.className).toContain('border-border-subtle');
  });
});

describe('BillingFaq — nota fiscal framing (D5)', () => {
  it('frames nota fiscal as provider-dependent (Asaas), not as an included plan feature', () => {
    render(<BillingFaq />);

    const notaFiscalEntry = BILLING_FAQ_ENTRIES.find((e) =>
      e.answer.toLowerCase().includes('nota fiscal'),
    );
    expect(notaFiscalEntry).toBeDefined();

    // The rendered answer must name the payment-provider dependency (Asaas),
    // which is what marks it as forward-looking/provider-dependent rather than
    // an available feature.
    const answer = screen.getByText(notaFiscalEntry!.answer);
    expect(answer.textContent?.toLowerCase()).toContain('asaas');
  });

  it('does not present nota fiscal as a comparison-matrix plan feature', () => {
    render(<BillingFaq />);

    // None of the included plan-feature labels mention nota fiscal — the FAQ is
    // the only place it appears, and only as provider-dependent copy.
    const featureLabels = Object.values(FEATURE_LABELS).map((label) => label.toLowerCase());
    for (const label of featureLabels) {
      expect(label).not.toContain('nota fiscal');
    }
  });
});
