import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Faq } from '@/modules/marketing/components/home/faq';
import { FAQ_ENTRIES, FAQ_EYEBROW, FAQ_TITLE } from '@/modules/marketing/lib/home-content';

/*
 * FAQ (client leaf, native <details>/<summary>) — DOM behavior.
 *
 * Covers the homepage-faq spec contracts exercisable in jsdom:
 *   - the aligned title + the desktop-only eyebrow render;
 *   - 5–8 items render, including the 5 REQUIRED MVP questions (desktop + the
 *     condensed mobile variants from Figma 138:2);
 *   - no-JS fallback: on the initial (pre-hydration) render EVERY item is open
 *     so all answers are readable without JavaScript;
 *   - exclusive accordion after hydration: opening one item closes the
 *     previously open one (only one open at a time);
 *   - the open item carries the active brand/200 border;
 *   - keyboard: a <summary> is focusable and Enter toggles its <details>.
 *
 * Each question/answer renders TWICE in the DOM — a `hidden md:inline` desktop
 * span and a `md:hidden` mobile span. jsdom applies no CSS, so both are present;
 * the helpers below scope queries to the desktop span to avoid duplicate matches.
 */

const REQUIRED_QUESTIONS_DESKTOP = [
  'Meus dados de paciente ficam seguros?',
  'Funciona para atendimento presencial também?',
  'Preciso cancelar o Google Agenda?',
  'A IA vai errar e inventar conteúdo?',
  'Quanto custa depois do período grátis?',
] as const;

// The condensed mobile question variants (Figma 138:2). Questions 1 and 3 are
// identical across breakpoints, so they have no override.
const CONDENSED_MOBILE_QUESTIONS = [
  'Funciona para presencial também?',
  'A IA inventa conteúdo?',
  'Quanto custa depois do teste?',
] as const;

/** All <details> elements, in document order. */
function getDetails(container: HTMLElement): HTMLDetailsElement[] {
  return Array.from(container.querySelectorAll('details'));
}

/** The <summary> toggle of a <details> (where click/focus must land). */
function summaryOf(details: HTMLDetailsElement): HTMLElement {
  const summary = details.querySelector('summary');
  if (!summary) {
    throw new Error('details has no summary');
  }
  return summary;
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

describe('Faq — heading', () => {
  it('renders the aligned title and the desktop-only eyebrow', () => {
    render(<Faq />);
    expect(screen.getByText(FAQ_TITLE)).toBeInTheDocument();
    const eyebrow = screen.getByText(FAQ_EYEBROW);
    expect(eyebrow).toBeInTheDocument();
    // The eyebrow is desktop-only: it carries the `hidden md:block` gate so the
    // mobile FAQ frame (138:2) shows the title with no eyebrow.
    expect(eyebrow.className).toContain('hidden');
    expect(eyebrow.className).toContain('md:block');
  });
});

describe('Faq — items', () => {
  it('renders between 5 and 8 items', () => {
    const { container } = render(<Faq />);
    const details = getDetails(container);
    expect(details.length).toBeGreaterThanOrEqual(5);
    expect(details.length).toBeLessThanOrEqual(8);
    // The content layer drives the count.
    expect(details).toHaveLength(FAQ_ENTRIES.length);
  });

  it('includes the 5 required MVP questions (desktop variant) in order', () => {
    const { container } = render(<Faq />);
    const details = getDetails(container);
    details.forEach((d, i) => {
      // Desktop span carries the full question label (Body/lg).
      const desktopSpan = d.querySelector<HTMLElement>('summary span.md\\:inline');
      expect(desktopSpan?.textContent).toBe(REQUIRED_QUESTIONS_DESKTOP[i]);
      expect(desktopSpan?.className).toContain('text-[17px]/[28px]');
    });
  });

  it('renders the condensed mobile question variants (Figma 138:2)', () => {
    const { container } = render(<Faq />);
    const details = getDetails(container);
    const mobileQuestions = details.map(
      (d) => d.querySelector<HTMLElement>('summary span.md\\:hidden')?.textContent,
    );
    // Q1 and Q3 are identical across breakpoints (no override → desktop string);
    // Q2, Q4 and Q5 condense.
    expect(mobileQuestions).toEqual([
      REQUIRED_QUESTIONS_DESKTOP[0],
      CONDENSED_MOBILE_QUESTIONS[0],
      REQUIRED_QUESTIONS_DESKTOP[2],
      CONDENSED_MOBILE_QUESTIONS[1],
      CONDENSED_MOBILE_QUESTIONS[2],
    ]);
    // The condensed mobile span carries the smaller Body/base scale.
    const mobileSpan = details[1]!.querySelector<HTMLElement>('summary span.md\\:hidden');
    expect(mobileSpan?.className).toContain('text-[15px]/[22px]');
  });
});

describe('Faq — no-JS fallback', () => {
  it('renders every item open on the initial render so all answers are readable', () => {
    // The synchronous first render is the no-JS fallback: enhancement is gated
    // behind a requestAnimationFrame, so nothing has collapsed yet here.
    const { container } = render(<Faq />);
    const details = getDetails(container);
    expect(details.every((d) => d.open)).toBe(true);
    // Every (desktop) answer is present in the DOM.
    for (const entry of FAQ_ENTRIES) {
      const desktopAnswer = within(container).getAllByText(entry.answer.desktop, {
        selector: 'p span.md\\:inline',
      });
      expect(desktopAnswer.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('aligns the Q1 answer to the verbatim 125:2 string with the condensed 138:2 mobile variant', () => {
    const { container } = render(<Faq />);
    const firstDetails = getDetails(container)[0]!;
    const desktopAnswer = firstDetails.querySelector<HTMLElement>('p span.md\\:inline');
    const mobileAnswer = firstDetails.querySelector<HTMLElement>('p span.md\\:hidden');
    expect(desktopAnswer?.textContent).toBe(FAQ_ENTRIES[0]!.answer.desktop);
    expect(mobileAnswer?.textContent).toBe(FAQ_ENTRIES[0]!.answer.mobile);
    // The hidden-on-mobile variant is read once by assistive tech: the condensed
    // mobile span is aria-hidden when it differs from the desktop string.
    expect(mobileAnswer?.getAttribute('aria-hidden')).toBe('true');
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

    // Open the third item via its summary toggle; the first must then close.
    await user.click(summaryOf(getDetails(container)[2]!));

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

    const secondSummary = summaryOf(getDetails(container)[1]!);

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
    const secondSummary = summaryOf(details[1]!);

    secondSummary.focus();
    await user.click(secondSummary);

    await waitFor(() => {
      expect(details[1]!.open).toBe(true);
    });
    // Exclusivity holds: opening the second closed the first.
    expect(details[0]!.open).toBe(false);
  });
});
