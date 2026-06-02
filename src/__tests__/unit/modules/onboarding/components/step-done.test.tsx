import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StepDone, type OnboardingSummary } from '@/modules/onboarding/components/step-done';

// next/navigation's useRouter is not available in jsdom; stub push so we can
// assert navigation intent without a real router.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Sonner toasts have no jsdom-renderable surface we assert on; stub them.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_DONE: OnboardingSummary = {
  profileCompleted: true,
  locationConfigured: true,
  firstPatientAdded: true,
};

function renderStep(
  overrides: {
    summary?: OnboardingSummary;
    onComplete?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const summary = overrides.summary ?? ALL_DONE;
  const onComplete = overrides.onComplete ?? vi.fn().mockResolvedValue({ ok: true });

  render(<StepDone summary={summary} onComplete={onComplete} />);
  return { onComplete };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StepDone', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('renders a check for each configured item and no "Configurar agora" link', () => {
    renderStep({ summary: ALL_DONE });

    expect(screen.getByTestId('step-done-item-profile-check')).toBeInTheDocument();
    expect(screen.getByTestId('step-done-item-location-check')).toBeInTheDocument();
    expect(screen.getByTestId('step-done-item-patients-check')).toBeInTheDocument();

    expect(screen.queryByTestId('step-done-item-profile-configure')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-done-item-location-configure')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-done-item-patients-configure')).not.toBeInTheDocument();
  });

  it('renders a non-blocking "Configurar agora" link for a missing item while keeping CTAs enabled', () => {
    renderStep({
      summary: { profileCompleted: true, locationConfigured: true, firstPatientAdded: false },
    });

    // Missing item → link to its configuration step, no check. `Button asChild`
    // renders the anchor itself, so the testid lands on the <a>.
    const configure = screen.getByTestId('step-done-item-patients-configure');
    expect(configure.tagName).toBe('A');
    expect(configure).toHaveAttribute('href', '/onboarding/setup/patients');
    expect(screen.queryByTestId('step-done-item-patients-check')).not.toBeInTheDocument();

    // Configured items keep their checks.
    expect(screen.getByTestId('step-done-item-profile-check')).toBeInTheDocument();
    expect(screen.getByTestId('step-done-item-location-check')).toBeInTheDocument();

    // CTAs remain enabled — the missing item is non-blocking.
    expect(screen.getByTestId('step-done-cta-agenda')).toBeEnabled();
    expect(screen.getByTestId('step-done-cta-dashboard')).toBeEnabled();
  });

  it('shows the check vs. link per item independently of the others', () => {
    renderStep({
      summary: { profileCompleted: false, locationConfigured: true, firstPatientAdded: false },
    });

    expect(screen.getByTestId('step-done-item-profile-configure')).toBeInTheDocument();
    expect(screen.getByTestId('step-done-item-location-check')).toBeInTheDocument();
    expect(screen.getByTestId('step-done-item-patients-configure')).toBeInTheDocument();
  });

  it('completes onboarding then navigates to /agenda from the primary CTA', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue({ ok: true });
    renderStep({ onComplete });

    await user.click(screen.getByTestId('step-done-cta-agenda'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(pushMock).toHaveBeenCalledWith('/agenda');
  });

  it('completes onboarding then navigates to /dashboard from the secondary CTA', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue({ ok: true });
    renderStep({ onComplete });

    await user.click(screen.getByTestId('step-done-cta-dashboard'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(pushMock).toHaveBeenCalledWith('/dashboard');
  });

  it('does not navigate when completion fails', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue({ ok: false, error: 'unauthenticated' });
    renderStep({ onComplete });

    await user.click(screen.getByTestId('step-done-cta-dashboard'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('renders "O que vem em breve" as informational text with no actionable post-MVP modules', () => {
    renderStep({ summary: ALL_DONE });

    const comingSoon = screen.getByTestId('step-done-coming-soon');
    expect(comingSoon).toBeInTheDocument();
    expect(comingSoon).toHaveTextContent('O que vem em breve');

    // The post-MVP modules are listed as plain text...
    expect(comingSoon).toHaveTextContent(/WhatsApp/i);
    expect(comingSoon).toHaveTextContent(/PIX/i);
    expect(comingSoon).toHaveTextContent(/Receita Saúde/i);

    // ...but NOTHING in that section is actionable (no links, no buttons).
    expect(within(comingSoon).queryAllByRole('link')).toHaveLength(0);
    expect(within(comingSoon).queryAllByRole('button')).toHaveLength(0);
  });

  it('keeps post-MVP module names out of every actionable control', () => {
    renderStep({ summary: ALL_DONE });

    const forbidden = /whatsapp|receita saúde|pix|cobrança|recibo/i;

    for (const link of screen.queryAllByRole('link')) {
      expect(link.textContent ?? '').not.toMatch(forbidden);
    }
    for (const button of screen.queryAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(forbidden);
    }
  });
});
