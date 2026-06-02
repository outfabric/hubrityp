import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UnfinishedSetupBanner } from '@/modules/onboarding';

// ---------------------------------------------------------------------------
// Visibility rule: render only when `onboardingCompletedAt IS NULL` AND
// `onboardingStep !== 'done'`. Link targets the resume step derived from the
// persisted `onboardingStep`.
// ---------------------------------------------------------------------------

describe('UnfinishedSetupBanner', () => {
  it('renders for an incomplete profile (no completion timestamp, non-done step)', () => {
    render(<UnfinishedSetupBanner onboardingStep="location" onboardingCompletedAt={null} />);

    expect(screen.getByTestId('unfinished-setup-banner')).toBeInTheDocument();
    expect(screen.getByText('Você ainda não terminou a configuração inicial.')).toBeInTheDocument();
  });

  it('links "continuar" to the resume step matching the persisted onboarding step', () => {
    render(<UnfinishedSetupBanner onboardingStep="location" onboardingCompletedAt={null} />);

    const link = screen.getByTestId('unfinished-setup-banner-link');
    expect(link).toHaveTextContent('continuar');
    expect(link).toHaveAttribute('href', '/onboarding/setup/location');
  });

  it('resumes at the first step (profile) when the step is the pre-wizard "welcome"', () => {
    render(<UnfinishedSetupBanner onboardingStep="welcome" onboardingCompletedAt={null} />);

    expect(screen.getByTestId('unfinished-setup-banner-link')).toHaveAttribute(
      'href',
      '/onboarding/setup/profile',
    );
  });

  it('is hidden once onboarding is completed (completion timestamp set)', () => {
    render(
      <UnfinishedSetupBanner
        onboardingStep="location"
        onboardingCompletedAt={new Date('2026-01-01T00:00:00Z')}
      />,
    );

    expect(screen.queryByTestId('unfinished-setup-banner')).not.toBeInTheDocument();
  });

  it('is hidden when onboarding was skipped to the terminal "done" step', () => {
    render(<UnfinishedSetupBanner onboardingStep="done" onboardingCompletedAt={null} />);

    expect(screen.queryByTestId('unfinished-setup-banner')).not.toBeInTheDocument();
  });
});
