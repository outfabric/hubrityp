import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StepProfile } from '@/modules/onboarding/components/step-profile';

// Sonner toasts have no jsdom-renderable surface we assert on; stub them.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The App Router is not mounted in jsdom; stub `useRouter` so the forward
// navigation on save success (`router.push('/onboarding/setup/location')`) is
// observable instead of throwing the "expected app router to be mounted"
// invariant.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderStep(
  overrides: {
    onSaveStep?: ReturnType<typeof vi.fn>;
    onUploadPhoto?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const onSaveStep = overrides.onSaveStep ?? vi.fn().mockResolvedValue({ ok: true });
  const onUploadPhoto =
    overrides.onUploadPhoto ?? vi.fn().mockResolvedValue({ ok: true, objectKey: 'uid/uuid.png' });

  render(<StepProfile onSaveStep={onSaveStep} onUploadPhoto={onUploadPhoto} />);
  return { onSaveStep, onUploadPhoto };
}

// ---------------------------------------------------------------------------
// Tests — RHF validation + inline error styling per Sálvia design system
// ---------------------------------------------------------------------------

describe('StepProfile', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('shows a required-field error for an empty display name on blur (blur-time validation)', async () => {
    const user = userEvent.setup();
    renderStep();

    const input = screen.getByTestId('step-profile-display-name');
    // Touch then blur with no value → onTouched validation fires.
    await user.click(input);
    await user.tab();

    const error = await screen.findByTestId('step-profile-display-name-error');
    expect(error).toHaveTextContent('O nome de exibição é obrigatório.');
  });

  it('marks the display name input invalid and styles the error with the danger token', async () => {
    const user = userEvent.setup();
    renderStep();

    const input = screen.getByTestId('step-profile-display-name');
    await user.click(input);
    await user.tab();

    await waitFor(() => {
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    const error = screen.getByTestId('step-profile-display-name-error');
    // Inline message uses the design-system danger token (never a tooltip).
    expect(error).toHaveClass('text-danger-700');
    expect(error).toHaveAttribute('role', 'alert');
    // The input is wired to its error message for assistive tech.
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('does not call onSaveStep when the display name is missing', async () => {
    const user = userEvent.setup();
    const { onSaveStep } = renderStep();

    await user.click(screen.getByTestId('step-profile-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('step-profile-display-name-error')).toBeInTheDocument();
    });
    expect(onSaveStep).not.toHaveBeenCalled();
  });

  it('calls onSaveStep once with the typed form values and navigates forward to step 2 on success', async () => {
    const user = userEvent.setup();
    const onSaveStep = vi.fn().mockResolvedValue({ ok: true });
    renderStep({ onSaveStep });

    await user.type(screen.getByTestId('step-profile-display-name'), 'Marina Costa');
    await user.click(screen.getByTestId('step-profile-submit'));

    await waitFor(() => {
      expect(onSaveStep).toHaveBeenCalledTimes(1);
    });
    // The collected display name is passed through to the server action (so it
    // can be persisted to `profiles.full_name`), not silently dropped.
    expect(onSaveStep).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Marina Costa' }),
    );
    // On a successful save the wizard advances the user to the location step.
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/onboarding/setup/location');
    });
  });

  it('maps a server invalid_input field error back onto the display name field', async () => {
    const user = userEvent.setup();
    const onSaveStep = vi.fn().mockResolvedValue({
      ok: false,
      error: 'invalid_input',
      fieldErrors: { displayName: ['Nome inválido no servidor.'] },
    });
    renderStep({ onSaveStep });

    await user.type(screen.getByTestId('step-profile-display-name'), 'Marina');
    await user.click(screen.getByTestId('step-profile-submit'));

    const error = await screen.findByTestId('step-profile-display-name-error');
    expect(error).toHaveTextContent('Nome inválido no servidor.');
  });

  it('does not upload a non-image file selected in the photo input (client advisory check)', async () => {
    const user = userEvent.setup();
    const onUploadPhoto = vi.fn().mockResolvedValue({ ok: true, objectKey: 'x' });
    renderStep({ onUploadPhoto });

    const fileInput = screen.getByTestId('step-profile-photo-input');
    const pdf = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, pdf);

    expect(onUploadPhoto).not.toHaveBeenCalled();
  });

  it('uploads a valid image through onUploadPhoto', async () => {
    const user = userEvent.setup();
    const onUploadPhoto = vi.fn().mockResolvedValue({ ok: true, objectKey: 'uid/uuid.png' });
    renderStep({ onUploadPhoto });

    const fileInput = screen.getByTestId('step-profile-photo-input');
    const png = new File([new Uint8Array(10)], 'me.png', { type: 'image/png' });
    await user.upload(fileInput, png);

    await waitFor(() => {
      expect(onUploadPhoto).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('step-profile-photo-name')).toHaveTextContent('me.png');
  });
});
