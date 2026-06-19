import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Confianca } from '@/modules/marketing/components/home/confianca';
import { TRUST } from '@/modules/marketing/lib/home-content';

/*
 * Confiança (presentational section) — the regulatory-trust band of the homepage.
 *
 * Behavioral contracts:
 *   - the title and closer render from the content layer;
 *   - EXACTLY 8 guarantees render, each with its own brand/700 checkmark;
 *   - every required regulatory literal (CFP resolution codes/years, LGPD data
 *     residency, AES-256 / TLS 1.3, Lei 13.787/2018, CRP ativo) is present —
 *     these strings are regulatory and must not drift.
 */

// The literal codes/years the spec requires to appear verbatim. A drift in any
// of these (e.g. a wrong resolution year) is a compliance defect, not a typo.
const REQUIRED_LITERALS = [
  '001/2009',
  '06/2019',
  '09/2024',
  '13/2022',
  'AES-256',
  'TLS 1.3',
  '13.787/2018',
  'CRP ativo',
] as const;

describe('Confianca — copy', () => {
  it('renders the title and the closing line from the content layer', () => {
    render(<Confianca />);

    expect(screen.getByRole('heading', { name: TRUST.title })).toBeInTheDocument();
    expect(screen.getByText(TRUST.closer)).toBeInTheDocument();
  });
});

describe('Confianca — guarantees', () => {
  it('renders exactly 8 checkmarked guarantees', () => {
    const { container } = render(<Confianca />);

    expect(TRUST.guarantees).toHaveLength(8);

    // One list item (and therefore one checkmark) per guarantee.
    const items = container.querySelectorAll('ul li');
    expect(items).toHaveLength(8);

    for (const guarantee of TRUST.guarantees) {
      expect(screen.getByText(guarantee.text)).toBeInTheDocument();
    }
  });

  it('contains every required regulatory literal verbatim', () => {
    render(<Confianca />);

    const allText = TRUST.guarantees.map((g) => g.text).join(' ');
    for (const literal of REQUIRED_LITERALS) {
      // Assert against the rendered DOM, not just the content constant.
      expect(allText).toContain(literal);
      expect(
        screen.getByText((_, node) => node?.textContent?.includes(literal) ?? false, {
          selector: 'li',
        }),
      ).toBeInTheDocument();
    }
  });
});

describe('Confianca — checkmark color', () => {
  it('tints each checkmark with brand/700 and no extra semantic green', () => {
    const { container } = render(<Confianca />);

    const checks = container.querySelectorAll('ul li svg');
    expect(checks).toHaveLength(8);

    for (const check of checks) {
      expect(check.getAttribute('class')).toContain('text-brand-700');
      // DS rule: no extra semantic green just for these checks.
      expect(check.getAttribute('class')).not.toMatch(/text-(green|emerald|success)/);
    }
  });
});
