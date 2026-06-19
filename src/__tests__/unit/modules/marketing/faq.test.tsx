import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Faq } from '@/modules/marketing/components/home/faq';
import { FAQ_ENTRIES } from '@/modules/marketing/lib/home-content';

/*
 * FAQ (client leaf, native <details>/<summary>) — DOM behavior.
 *
 * Covers the homepage-faq spec contracts exercisable in jsdom:
 *   - 5–8 items render, including the 5 REQUIRED MVP questions verbatim;
 *   - no-JS fallback: on the initial (pre-hydration) render EVERY item is open
 *     so all answers are readable without JavaScript;
 *   - exclusive accordion after hydration: opening one item closes the
 *     previously open one (only one open at a time);
 *   - the open item carries the active brand/200 border;
 *   - keyboard: a <summary> is focusable and Enter toggles its <details>.
 */

const REQUIRED_QUESTIONS = [
  'Meus dados de paciente ficam seguros?',
  'Funciona para atendimento presencial também?',
  'Preciso cancelar o Google Agenda?',
  'A IA vai errar e inventar conteúdo?',
  'Quanto custa depois do período grátis?',
] as const;

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

describe('Faq — items', () => {
  it('renders between 5 and 8 items', () => {
    const { container } = render(<Faq />);
    const details = getDetails(container);
    expect(details.length).toBeGreaterThanOrEqual(5);
    expect(details.length).toBeLessThanOrEqual(8);
    // The content layer drives the count.
    expect(details).toHaveLength(FAQ_ENTRIES.length);
  });

  it('includes the 5 required MVP questions verbatim', () => {
    render(<Faq />);
    for (const question of REQUIRED_QUESTIONS) {
      expect(screen.getByText(question)).toBeInTheDocument();
    }
  });
});

describe('Faq — no-JS fallback', () => {
  it('renders every item open on the initial render so all answers are readable', () => {
    // The synchronous first render is the no-JS fallback: enhancement is gated
    // behind a requestAnimationFrame, so nothing has collapsed yet here.
    const { container } = render(<Faq />);
    const details = getDetails(container);
    expect(details.every((d) => d.open)).toBe(true);
    // Every answer is present in the DOM.
    for (const entry of FAQ_ENTRIES) {
      expect(screen.getByText(entry.answer)).toBeInTheDocument();
    }
  });
});

describe('Faq — exclusive accordion (after hydration)', () => {
  it('collapses to a single open item once enhanced', async () => {
    const { container } = render(<Faq />);
    await waitForExclusive(container);
    expect(openIndices(container)).toEqual([0]);
  });

  it('closes the previously open item when another opens', async () => {
    const user = userEvent.setup();
    const { container } = render(<Faq />);
    await waitForExclusive(container);

    const summaries = screen.getAllByText(REQUIRED_QUESTIONS[2], { selector: 'summary' });
    await user.click(summaries[0]!);

    // Only the third item is open now; the first one closed.
    await waitFor(() => {
      expect(openIndices(container)).toEqual([2]);
    });
  });

  it('marks the open item with the active brand/200 border and others as subtle', async () => {
    const { container } = render(<Faq />);
    await waitForExclusive(container);

    const details = getDetails(container);
    expect(details[0]!.className).toContain('border-brand-200');
    expect(details[1]!.className).not.toContain('border-brand-200');
    expect(details[1]!.className).toContain('border-border-subtle');
  });
});

describe('Faq — keyboard', () => {
  it('exposes a focusable summary with a visible focus state', async () => {
    const { container } = render(<Faq />);
    await waitForExclusive(container);

    const details = getDetails(container);
    const secondSummary = within(details[1]!).getByText(FAQ_ENTRIES[1]!.question);

    // <summary> is natively focusable (Tab-reachable) and carries a visible
    // focus ring so keyboard users can see the active question.
    secondSummary.focus();
    expect(secondSummary).toHaveFocus();
    expect(secondSummary.className).toContain('focus-visible:shadow-focus');
  });

  it('enforces exclusivity when a closed item is toggled open', async () => {
    // jsdom does not implement the native Enter/Space -> toggle on <summary>,
    // but userEvent.click does fire the toggle the same way a keyboard
    // activation would. This asserts the exclusive accordion logic that backs
    // keyboard activation: opening the second item closes the first.
    const user = userEvent.setup();
    const { container } = render(<Faq />);
    await waitForExclusive(container);

    const details = getDetails(container);
    const secondSummary = within(details[1]!).getByText(FAQ_ENTRIES[1]!.question);

    secondSummary.focus();
    await user.click(secondSummary);

    await waitFor(() => {
      expect(details[1]!.open).toBe(true);
    });
    // Exclusivity holds: opening the second closed the first.
    expect(details[0]!.open).toBe(false);
  });
});
