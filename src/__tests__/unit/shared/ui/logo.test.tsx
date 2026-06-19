import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo } from '@/shared/ui/logo';

const VARIANTS = ['lockup-h', 'lockup-v', 'symbol'] as const;

// Brand palette mandated by public/brand/*.svg — preserved only for tone="color".
const BRAND_HEX = ['#587355', '#5B7A93', '#3F6F63', '#21261F'];

describe('Logo', () => {
  it.each(VARIANTS)('exposes the accessible name "Hubrity" for variant %s', (variant) => {
    render(<Logo variant={variant} />);
    expect(screen.getByRole('img', { name: 'Hubrity' })).toBeInTheDocument();
  });

  it('renders an inline <svg> and never an <img>', () => {
    const { container } = render(<Logo />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps the accessible name on the symbol variant without rendering the wordmark', () => {
    const { container: lockup } = render(<Logo variant="lockup-h" />);
    const { container: symbol } = render(<Logo variant="symbol" />);

    expect(screen.getAllByRole('img', { name: 'Hubrity' }).length).toBeGreaterThanOrEqual(2);

    // The wordmark is 7 <path> nodes; the symbol is rects only.
    expect(lockup.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(symbol.querySelectorAll('path').length).toBe(0);
    expect(symbol.querySelectorAll('rect').length).toBe(3);
  });

  it('uses currentColor for every fill when tone="mono"', () => {
    const { container } = render(<Logo variant="lockup-h" tone="mono" />);
    const filled = container.querySelectorAll('[fill]');
    const fills = Array.from(filled)
      .map((el) => el.getAttribute('fill'))
      .filter((fill): fill is string => fill !== null && fill !== 'none');

    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill).toBe('currentColor');
    }
    // No brand hex must leak into the mono variant.
    for (const hex of BRAND_HEX) {
      expect(container.innerHTML).not.toContain(hex);
    }
  });

  it('preserves the brand hex palette when tone="color"', () => {
    const { container } = render(<Logo variant="lockup-h" tone="color" />);
    for (const hex of BRAND_HEX) {
      expect(container.innerHTML).toContain(hex);
    }
  });

  describe('tone="inverse" (dark-surface lockup)', () => {
    // The symbol's tricolor brand fills (sage / slate-blue / teal).
    const SYMBOL_HEX = ['#587355', '#5B7A93', '#3F6F63'];

    it('keeps the symbol tricolor and renders the wordmark light (#FAFAF9)', () => {
      const { container } = render(<Logo variant="lockup-h" tone="inverse" />);

      // Symbol keeps its three brand fills...
      for (const hex of SYMBOL_HEX) {
        expect(container.innerHTML).toContain(hex);
      }
      // ...but the wordmark is light, not ink (#21261F).
      expect(container.innerHTML).toContain('#FAFAF9');
      expect(container.innerHTML).not.toContain('#21261F');
    });

    it('keeps the symbol tricolor for the symbol-only variant', () => {
      const { container } = render(<Logo variant="symbol" tone="inverse" />);
      for (const hex of SYMBOL_HEX) {
        expect(container.innerHTML).toContain(hex);
      }
      // The symbol has no wordmark, so no <path> (light wordmark fill) leaks in.
      expect(container.querySelectorAll('path').length).toBe(0);
    });

    it('does not collapse fills to currentColor (distinct from mono/white)', () => {
      const { container } = render(<Logo variant="lockup-h" tone="inverse" />);
      expect(container.innerHTML).not.toContain('currentColor');
    });

    it('does not force text-white (symbol uses literal hex, not inherited color)', () => {
      render(<Logo variant="symbol" tone="inverse" />);
      const svg = screen.getByRole('img', { name: 'Hubrity' });
      expect(svg).not.toHaveClass('text-white');
    });

    it('renders the wordmark light on the live-text variant', () => {
      render(<Logo variant="wordmark-text" tone="inverse" />);
      // jsdom normalizes hex colors to rgb() in inline styles.
      expect(screen.getByRole('img', { name: 'Hubrity' }).style.color).toBe('rgb(250, 250, 249)'); // #FAFAF9
    });
  });

  it('applies text-white by default for tone="white" so currentColor resolves to white', () => {
    render(<Logo variant="symbol" tone="white" />);
    const svg = screen.getByRole('img', { name: 'Hubrity' });
    expect(svg).toHaveClass('text-white');
    expect(svg.querySelectorAll('[fill]:not([fill="none"])').length).toBeGreaterThan(0);
    svg.querySelectorAll('[fill]:not([fill="none"])').forEach((el) => {
      expect(el.getAttribute('fill')).toBe('currentColor');
    });
  });

  it('is not a link or button (non-interactive mark)', () => {
    const { container } = render(<Logo />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  describe('wordmark-text variant (Nunito live text)', () => {
    it('renders "hubrity" as a span using the --ds-font-wordmark variable', () => {
      render(<Logo variant="wordmark-text" />);
      const wordmark = screen.getByRole('img', { name: 'Hubrity' });

      expect(wordmark.tagName).toBe('SPAN');
      expect(wordmark.textContent).toBe('hubrity');
      // The whole point of this variant: it consumes the Nunito wordmark
      // variable, never Inter (`--ds-font-sans`).
      expect(wordmark.style.fontFamily).toBe('var(--ds-font-wordmark)');
      expect(wordmark.style.fontFamily).not.toContain('--ds-font-sans');
      // ~ -1% brand tracking, semibold (600), lowercase.
      expect(wordmark.style.letterSpacing).toBe('-0.01em');
      expect(wordmark).toHaveClass('font-wordmark', 'font-semibold', 'lowercase');
    });

    it('uses ink color on light/mono tones and inverse on white tone', () => {
      const { rerender } = render(<Logo variant="wordmark-text" tone="color" />);
      // jsdom normalizes hex colors to rgb() in inline styles.
      expect(screen.getByRole('img', { name: 'Hubrity' }).style.color).toBe('rgb(33, 38, 31)'); // #21261F

      rerender(<Logo variant="wordmark-text" tone="white" />);
      expect(screen.getByRole('img', { name: 'Hubrity' }).style.color).toBe('rgb(250, 250, 249)'); // #FAFAF9
    });

    it('stays non-interactive (no <a>/<button>) and renders no <svg>/<img>', () => {
      const { container } = render(<Logo variant="wordmark-text" />);
      expect(container.querySelector('a')).toBeNull();
      expect(container.querySelector('button')).toBeNull();
      expect(container.querySelector('svg')).toBeNull();
      expect(container.querySelector('img')).toBeNull();
    });
  });
});
