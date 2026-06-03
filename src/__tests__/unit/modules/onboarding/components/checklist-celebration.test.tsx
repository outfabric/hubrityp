import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChecklistCelebration } from '@/modules/onboarding/components/checklist-celebration';

// Animation class names that would signal a dramatic/bouncing flourish — the
// Sálvia design system forbids these (rules.md §Proibições absolutas, §Animação).
// The celebration must use none of them.
const FORBIDDEN_ANIMATION_CLASSES = [
  'animate-bounce',
  'animate-ping',
  'animate-spin',
  'animate-pulse',
];

describe('ChecklistCelebration', () => {
  it('renders nothing when the checklist is not complete', () => {
    const { container } = render(<ChecklistCelebration complete={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('onboarding-checklist-celebration')).not.toBeInTheDocument();
  });

  it('renders the completion message when complete', () => {
    render(<ChecklistCelebration complete />);

    expect(screen.getByTestId('onboarding-checklist-celebration')).toHaveTextContent(
      'Você completou a configuração inicial. Seu consultório está no sistema!',
    );
  });

  it('announces completion politely to assistive tech', () => {
    render(<ChecklistCelebration complete />);

    const region = screen.getByTestId('onboarding-checklist-celebration');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('drives the flourish via the bounded CSS animation class (governed by the global prefers-reduced-motion guard)', () => {
    render(<ChecklistCelebration complete />);

    // The flourish is the `onboarding-celebration` keyframe class. Its duration
    // (300ms) and the reduced-motion collapse to 0.01ms both live in globals.css
    // under `@media (prefers-reduced-motion: reduce)`, so motion-averse users get
    // a near-instant, no-movement appearance without a separate JS branch.
    const region = screen.getByTestId('onboarding-checklist-celebration');
    expect(region).toHaveClass('onboarding-celebration');
  });

  it('uses no bouncing or dramatic animation utility classes', () => {
    const { container } = render(<ChecklistCelebration complete />);
    const html = container.innerHTML;

    for (const forbidden of FORBIDDEN_ANIMATION_CLASSES) {
      expect(html).not.toContain(forbidden);
    }
  });
});
