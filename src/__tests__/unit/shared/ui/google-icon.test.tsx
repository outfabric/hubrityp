import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GoogleIcon } from '@/shared/ui/google-icon';

// Official Google "G" palette — fixed brand hex, never recolored to currentColor.
const GOOGLE_HEX = ['#4285F4', '#34A853', '#FBBC05', '#EA4335'];

describe('GoogleIcon', () => {
  it('renders an inline <svg> and never an <img>', () => {
    const { container } = render(<GoogleIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('marks the decorative glyph aria-hidden', () => {
    const { container } = render(<GoogleIcon />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the official Google brand colors (no currentColor)', () => {
    const { container } = render(<GoogleIcon />);
    for (const hex of GOOGLE_HEX) {
      expect(container.innerHTML).toContain(hex);
    }
    expect(container.innerHTML).not.toContain('currentColor');
  });

  it('merges a caller className onto the svg', () => {
    const { container } = render(<GoogleIcon className="size-5" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('size-5');
  });
});
