import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SolucaoTimeline } from '@/modules/marketing/components/home/solucao-timeline';
import {
  SOLUTION_CLOSER,
  SOLUTION_STEPS,
  SOLUTION_SUBTITLE,
  SOLUTION_TITLE,
} from '@/modules/marketing/lib/home-content';

/*
 * SolucaoTimeline (Client Component, presentational) — the value-cycle section
 * of the public homepage (`/`).
 *
 * Behavioral contracts (D5 — scroll fade-in, reduced-motion-guarded):
 *   - renders the six steps in spec order plus the closer;
 *   - content is VISIBLE BY DEFAULT — it is never gated behind JS or scroll;
 *   - under `prefers-reduced-motion: reduce` the fade-in enhancement is DISABLED
 *     (no IntersectionObserver, no hidden-until-seen state);
 *   - even with the fade-in active, content is never permanently stuck at
 *     opacity 0 — the observer reveals each item.
 */

/** Install a `matchMedia` stub that reports the given reduced-motion preference. */
function stubMatchMedia(prefersReducedMotion: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? prefersReducedMotion : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/**
 * Install a controllable IntersectionObserver stub. Returns a handle whose
 * `triggerAll()` fires the callback as if every observed element scrolled into
 * view, so a test can assert the reveal behavior deterministically.
 */
function stubIntersectionObserver(): {
  observed: Element[];
  triggerAll: () => void;
  instances: number;
} {
  const observed: Element[] = [];
  const state = { observed, triggerAll: () => {}, instances: 0 };

  class MockIntersectionObserver {
    private readonly cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      state.instances += 1;
      state.triggerAll = () => {
        const entries = observed.map(
          (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
        );
        this.cb(entries, this as unknown as IntersectionObserver);
      };
    }
    observe(el: Element): void {
      observed.push(el);
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SolucaoTimeline — content', () => {
  beforeEach(() => {
    // Reduced motion ON by default for content assertions: the fade-in is off,
    // so we exercise the pure presentational baseline.
    stubMatchMedia(true);
  });

  it('renders the six solution steps in spec order', () => {
    render(<SolucaoTimeline />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items).toHaveLength(SOLUTION_STEPS.length);

    // Each item appears in document order matching SOLUTION_STEPS. Both the
    // desktop and condensed-mobile copy are rendered (toggled by CSS), so the
    // step's heading carries the desktop title and the desktop explanation is
    // present in the item.
    items.forEach((item, index) => {
      const step = SOLUTION_STEPS[index];
      expect(step).toBeDefined();
      expect(
        within(item).getByRole('heading', { name: new RegExp(step!.title.desktop) }),
      ).toBeInTheDocument();
      expect(within(item).getByText(step!.description.desktop)).toBeInTheDocument();
    });
  });

  it('renders the section title (both breakpoint variants) and the desktop subtitle', () => {
    render(<SolucaoTimeline />);

    expect(screen.getByText(SOLUTION_TITLE.desktop)).toBeInTheDocument();
    expect(screen.getByText(SOLUTION_TITLE.mobile)).toBeInTheDocument();
    expect(screen.getByText(SOLUTION_SUBTITLE)).toBeInTheDocument();
  });

  it('renders a desktop "PASSO 0N" marker for every step', () => {
    render(<SolucaoTimeline />);

    SOLUTION_STEPS.forEach((step) => {
      const marker = `Passo ${String(step.order).padStart(2, '0')}`;
      expect(screen.getByText(marker)).toBeInTheDocument();
    });
  });

  it('inline-numbers each step ("N.") for the mobile variant', () => {
    render(<SolucaoTimeline />);

    const items = screen.getAllByRole('listitem');
    items.forEach((item, index) => {
      const step = SOLUTION_STEPS[index]!;
      const mobileTitle = step.title.mobile ?? step.title.desktop;
      // The mobile heading variant is prefixed with the 1-based number + ". ".
      expect(within(item).getByText(`${step.order}. ${mobileTitle}`)).toBeInTheDocument();
    });
  });

  it('renders the closer line', () => {
    render(<SolucaoTimeline />);
    expect(screen.getByText(SOLUTION_CLOSER)).toBeInTheDocument();
    expect(SOLUTION_CLOSER).toMatch(/De ponta a ponta/);
  });

  it('hides the closer line on mobile (hidden md:block)', () => {
    render(<SolucaoTimeline />);
    const closer = screen.getByText(SOLUTION_CLOSER);
    expect(closer).toHaveClass('hidden');
    expect(closer).toHaveClass('md:block');
  });

  it('makes every step content visible by default (never opacity 0)', () => {
    render(<SolucaoTimeline />);

    // Under reduced motion the fade-in is disabled, so no item carries the
    // hidden-until-seen state. The hidden variant only applies when
    // data-fade-visible === "false"; here the attribute must be unset.
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.getAttribute('data-fade-visible')).toBeNull();
    }
  });
});

describe('SolucaoTimeline — reduced-motion guard', () => {
  it('does NOT set up an IntersectionObserver under prefers-reduced-motion', () => {
    stubMatchMedia(true);
    const io = stubIntersectionObserver();

    render(<SolucaoTimeline />);

    expect(io.instances).toBe(0);
    expect(io.observed).toHaveLength(0);
    // No item is hidden — content stays at full opacity.
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.getAttribute('data-fade-visible')).toBeNull();
    }
  });
});

describe('SolucaoTimeline — fade-in enhancement (motion allowed)', () => {
  it('hides items until seen, then reveals them via the observer', () => {
    stubMatchMedia(false);
    const io = stubIntersectionObserver();

    render(<SolucaoTimeline />);

    const items = screen.getAllByRole('listitem');

    // Enhancement active: each item starts hidden-until-seen and is observed.
    expect(io.instances).toBe(1);
    expect(io.observed).toHaveLength(items.length);
    for (const item of items) {
      expect(item.getAttribute('data-fade-visible')).toBe('false');
    }

    // Scrolling into view flips every item to the visible state — content is
    // never permanently stuck at opacity 0.
    io.triggerAll();

    for (const item of items) {
      expect(item.getAttribute('data-fade-visible')).toBe('true');
    }
  });
});
