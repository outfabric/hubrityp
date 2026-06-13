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
});
