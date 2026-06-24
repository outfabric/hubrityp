import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Problema } from '@/modules/marketing/components/home/problema';
import { ProvaSocial } from '@/modules/marketing/components/home/prova-social';
import { PROBLEM, SOCIAL_PROOF_STATS } from '@/modules/marketing/lib/home-content';

/*
 * ProvaSocial + Problema (Server Components, presentational) — the market-data
 * bar and the "mirror" section of the public homepage (`/`).
 *
 * These cover the spec contracts exercisable in jsdom:
 *   - ProvaSocial renders the two reviewed market-data stat blocks (each a
 *     figure + a supporting caption) and contains NO fabricated testimonials
 *     (no quoted endorsements, no named people, no star/rating language);
 *   - Problema renders the title, exactly 5 mirror items, and the recognition
 *     (not judgment) closer.
 */

describe('ProvaSocial — market stats', () => {
  it('renders both stat blocks (figure + caption each)', () => {
    render(<ProvaSocial />);

    for (const stat of SOCIAL_PROOF_STATS) {
      expect(screen.getByText(stat.figure)).toBeInTheDocument();
      expect(screen.getByText(stat.caption)).toBeInTheDocument();
    }
  });

  it('renders exactly two stat blocks (no extra fabricated content)', () => {
    const { container } = render(<ProvaSocial />);
    // Each stat block carries exactly two paragraphs (figure + caption); assert
    // the total matches the content layer so no extra (fabricated) statement can
    // be added silently.
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(SOCIAL_PROOF_STATS.length * 2);
  });

  it('contains no fabricated testimonial language', () => {
    const { container } = render(<ProvaSocial />);
    const text = container.textContent ?? '';

    // No quoted endorsement, no attribution, no rating/recommendation phrasing.
    expect(text).not.toMatch(/[“”"].+[“”"]/);
    expect(text).not.toMatch(/recomend|depoimento|avalia|estrela|⭐|cliente satisfeit/i);
  });
});

describe('Problema — mirror section', () => {
  it('renders the title as the section heading', () => {
    render(<Problema />);
    expect(screen.getByRole('heading', { name: PROBLEM.title })).toBeInTheDocument();
  });

  it('renders exactly 5 mirror items', () => {
    render(<Problema />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items).toHaveLength(PROBLEM.items.length);

    for (const item of PROBLEM.items) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  it('renders the recognition closer (not judgment)', () => {
    render(<Problema />);
    expect(screen.getByText(PROBLEM.closer)).toBeInTheDocument();
    expect(PROBLEM.closer).toMatch(/Não é falta de organização/);
  });
});
