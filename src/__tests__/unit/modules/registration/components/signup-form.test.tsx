import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SignupForm, type SignUpResult } from '@/modules/registration/components/signup-form';

// Radix UI Checkbox/Select use ResizeObserver internally. jsdom does not
// provide it, so we stub it globally before tests run.
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// A no-op action stub. The form never invokes it in these render assertions —
// they only check the static layout / attributes of the Google-first control.
const noopAction = vi.fn<(formData: FormData) => Promise<SignUpResult>>(() =>
  Promise.resolve({ ok: true }),
);

describe('SignupForm — Google-first', () => {
  it('renders the GoogleButton with the signup-specific test id and label', () => {
    render(<SignupForm action={noopAction} />);
    const googleBtn = screen.getByTestId('signup-form-google-button');
    expect(googleBtn).toBeInTheDocument();
    expect(googleBtn).toHaveTextContent('Cadastrar com Google');
  });

  it('renders the GoogleButton as type="button" so it does not submit the form', () => {
    render(<SignupForm action={noopAction} />);
    const googleBtn = screen.getByTestId('signup-form-google-button');
    expect(googleBtn).toHaveAttribute('type', 'button');
  });

  it('renders the GoogleButton above the credential fields (Google-first)', () => {
    render(<SignupForm action={noopAction} />);
    const googleBtn = screen.getByTestId('signup-form-google-button');
    const nameField = screen.getByTestId('signup-form-name');

    // Google-first layout: the OAuth button must precede the first field in
    // document order. `Node.compareDocumentPosition` returns the
    // `DOCUMENT_POSITION_FOLLOWING` bit when `nameField` comes after `googleBtn`.
    expect(googleBtn.compareDocumentPosition(nameField)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
