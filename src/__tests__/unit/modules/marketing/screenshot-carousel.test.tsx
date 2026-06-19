import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  ScreenshotCarousel,
  type CarouselSlide,
} from '@/modules/marketing/components/home/screenshot-carousel';

/*
 * ScreenshotCarousel (client leaf) — DOM behavior.
 *
 * Covers the screenshot-carousel spec contracts exercisable in jsdom:
 *   - arrows / dots / Arrow keys change the visible slide AND its caption;
 *   - circular wrap (prev from the first lands on the last; next from the last
 *     wraps to the first);
 *   - NO auto-advance: with fake timers, advancing time changes nothing;
 *   - ARIA: role=region + aria-roledescription=carousel + label; each slide is
 *     role=group + aria-roledescription=slide + "N de M"; current dot is
 *     aria-selected;
 *   - focus is retained on the control after it moves the slide;
 *   - next/image lazy-loads off-screen slides;
 *   - static first-slide fallback markup: the first slide is visible and the
 *     others are `hidden` (so no-JS shows exactly one usable screenshot).
 */

const SLIDES: ReadonlyArray<CarouselSlide> = [
  {
    id: 'painel',
    src: '/screenshots/painel.webp',
    alt: 'Painel operacional do Hubrity.',
    caption: 'Seu dia em um painel.',
    width: 1306,
    height: 653,
  },
  {
    id: 'agenda',
    src: '/screenshots/agenda.webp',
    alt: 'Agenda semanal do Hubrity.',
    caption: 'Agenda semanal com status.',
    width: 1043,
    height: 651,
  },
  {
    id: 'evolucao',
    src: '/screenshots/evolucao.webp',
    alt: 'Evolução escrita pela IA.',
    caption: 'Evolução escrita pela IA.',
    width: 887,
    height: 651,
  },
];

function renderCarousel() {
  return render(<ScreenshotCarousel slides={SLIDES} label="Telas do sistema" />);
}

/** Returns the index of the single non-hidden slide group. */
function visibleSlideIndex(): number {
  const groups = screen.getAllByRole('group', { hidden: true });
  const visible = groups.findIndex((g) => !g.hidden);
  return visible;
}

/**
 * Waits for the post-hydration controls to be revealed. The carousel keeps its
 * arrows/dots inside a `hidden` wrapper until hydration (a `requestAnimationFrame`
 * gate matching `signup-cta.tsx`), so interactive assertions must await this.
 */
async function waitForControls(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Próximo slide' })).toBeVisible();
  });
}

describe('ScreenshotCarousel — ARIA structure', () => {
  it('exposes a carousel region with role=region, aria-roledescription and label', () => {
    renderCarousel();
    const region = screen.getByRole('region', { name: 'Telas do sistema' });
    expect(region).toHaveAttribute('aria-roledescription', 'carousel');
  });

  it('marks each slide as a role=group slide labelled "N de M"', () => {
    renderCarousel();
    const groups = screen.getAllByRole('group', { hidden: true });
    expect(groups).toHaveLength(SLIDES.length);
    groups.forEach((group, index) => {
      expect(group).toHaveAttribute('aria-roledescription', 'slide');
      expect(group).toHaveAttribute('aria-label', `${index + 1} de ${SLIDES.length}`);
    });
  });
});

describe('ScreenshotCarousel — static first-slide fallback', () => {
  it('renders the first slide visible and every other slide hidden (no-JS usable)', () => {
    renderCarousel();
    const groups = screen.getAllByRole('group', { hidden: true });
    expect(groups[0]!.hidden).toBe(false);
    expect(groups[1]!.hidden).toBe(true);
    expect(groups[2]!.hidden).toBe(true);
    // Exactly one slide is visible at a time.
    expect(visibleSlideIndex()).toBe(0);
  });

  it('shows the first slide caption initially', () => {
    renderCarousel();
    expect(screen.getByText('Seu dia em um painel.')).toBeInTheDocument();
  });
});

describe('ScreenshotCarousel — next/image lazy loading', () => {
  it('lazy-loads the off-screen slide images', () => {
    renderCarousel();
    // The off-screen slides (index ≥ 1) must carry loading="lazy" so they do
    // not block the initial payload.
    const images = screen.getAllByRole('img', { hidden: true });
    expect(images).toHaveLength(SLIDES.length);
    expect(images[1]).toHaveAttribute('loading', 'lazy');
    expect(images[2]).toHaveAttribute('loading', 'lazy');
    // Explicit width/height are present so the box is reserved (CLS < 0.1).
    expect(images[0]).toHaveAttribute('width', '1306');
    expect(images[0]).toHaveAttribute('height', '653');
  });
});

describe('ScreenshotCarousel — arrow controls', () => {
  it('advances to the next slide and updates the caption', async () => {
    const user = userEvent.setup();
    renderCarousel();
    await waitForControls();

    await user.click(screen.getByRole('button', { name: 'Próximo slide' }));

    expect(visibleSlideIndex()).toBe(1);
    expect(screen.getByText('Agenda semanal com status.')).toBeInTheDocument();
  });

  it('wraps from the first slide to the last when going previous (circular)', async () => {
    const user = userEvent.setup();
    renderCarousel();
    await waitForControls();

    await user.click(screen.getByRole('button', { name: 'Slide anterior' }));

    expect(visibleSlideIndex()).toBe(SLIDES.length - 1);
    expect(screen.getByText('Evolução escrita pela IA.')).toBeInTheDocument();
  });

  it('wraps from the last slide back to the first when going next (circular)', async () => {
    const user = userEvent.setup();
    renderCarousel();
    await waitForControls();

    const next = screen.getByRole('button', { name: 'Próximo slide' });
    await user.click(next); // -> 1
    await user.click(next); // -> 2 (last)
    await user.click(next); // -> wraps to 0

    expect(visibleSlideIndex()).toBe(0);
  });

  it('retains focus on the arrow after it moves the slide', async () => {
    const user = userEvent.setup();
    renderCarousel();
    await waitForControls();

    const next = screen.getByRole('button', { name: 'Próximo slide' });
    await user.click(next);

    expect(next).toHaveFocus();
  });
});

describe('ScreenshotCarousel — position dots', () => {
  it('marks the current dot as selected and jumps on click', async () => {
    const user = userEvent.setup();
    renderCarousel();
    await waitForControls();

    const tablist = screen.getByRole('tablist', { name: 'Selecionar slide' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(SLIDES.length);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    await user.click(tabs[2]!);

    expect(visibleSlideIndex()).toBe(2);
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('styles the active dot as a brand/600 pill', async () => {
    const user = userEvent.setup();
    renderCarousel();
    await waitForControls();

    const tablist = screen.getByRole('tablist', { name: 'Selecionar slide' });
    const tabs = within(tablist).getAllByRole('tab');
    // Active dot: brand/600 fill + wider pill; inactive: neutral + narrow dot.
    expect(tabs[0]!.className).toContain('bg-brand-600');
    expect(tabs[0]!.className).toContain('w-5');
    expect(tabs[1]!.className).not.toContain('bg-brand-600');

    await user.click(tabs[1]!);
    expect(tabs[1]!.className).toContain('bg-brand-600');
  });
});

describe('ScreenshotCarousel — keyboard navigation', () => {
  it('moves to the next slide on ArrowRight and back on ArrowLeft', async () => {
    const user = userEvent.setup();
    renderCarousel();
    await waitForControls();

    // Focus a control inside the region so the region's keydown handler runs.
    const next = screen.getByRole('button', { name: 'Próximo slide' });
    next.focus();

    await user.keyboard('{ArrowRight}');
    expect(visibleSlideIndex()).toBe(1);

    await user.keyboard('{ArrowLeft}');
    expect(visibleSlideIndex()).toBe(0);
  });

  it('wraps with ArrowLeft from the first slide (circular)', async () => {
    const user = userEvent.setup();
    renderCarousel();
    await waitForControls();

    screen.getByRole('button', { name: 'Slide anterior' }).focus();
    await user.keyboard('{ArrowLeft}');

    expect(visibleSlideIndex()).toBe(SLIDES.length - 1);
  });
});

describe('ScreenshotCarousel — no auto-play', () => {
  it('does not auto-advance over time (no timer)', () => {
    vi.useFakeTimers();
    try {
      renderCarousel();
      expect(visibleSlideIndex()).toBe(0);

      // Fast-forward well past any plausible auto-play interval. Wrapped in
      // act() because jsdom polyfills requestAnimationFrame on a timer, so the
      // hydration setState fires during this advance.
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      // Still on the first slide: there is no auto-advance.
      expect(visibleSlideIndex()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ScreenshotCarousel — empty input', () => {
  it('renders nothing when given no slides', () => {
    const { container } = render(<ScreenshotCarousel slides={[]} label="Vazio" />);
    expect(container).toBeEmptyDOMElement();
  });
});
