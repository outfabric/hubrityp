import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('SignupForm — consent inline links', () => {
  // Each row's inline link points to its legal page. The accessible name of the
  // anchor is its visible text (the trailing `ExternalLink` glyph is
  // `aria-hidden`), so `getByRole('link', { name })` resolves it unambiguously.
  const CONSENT_LINKS = [
    { name: /Termos de Uso/i, href: '/termos-de-uso' },
    { name: /Política de Privacidade/i, href: '/politica-de-privacidade' },
    { name: /dados sensíveis conforme a LGPD/i, href: '/politica-de-privacidade#lgpd' },
  ] as const;

  it.each(CONSENT_LINKS)(
    'renders the "$href" consent link as a new-tab anchor with a hardened rel',
    ({ name, href }) => {
      render(<SignupForm action={noopAction} />);

      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      // `noopener` severs the opener reference; `noreferrer` strips the
      // Referer header. Assert both are present regardless of ordering.
      const rel = link.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    },
  );

  it('renders the consent link as interactive content inside the checkbox label so reading never accepts (read ≠ accept)', () => {
    render(<SignupForm action={noopAction} />);

    const termsCheckbox = screen.getByTestId('signup-form-terms');
    expect(termsCheckbox).not.toBeChecked();

    const link = screen.getByRole('link', { name: /Termos de Uso/i });

    // Read ≠ accept is guaranteed by the HTML spec: a `<label>`'s activation
    // behavior is a no-op for clicks targeting an *interactive content
    // descendant* (an `<a href>`), so opening the Terms never toggles the
    // linked checkbox. We assert that exact structural precondition — the
    // link is an anchor with an `href`, nested in the `<label>` that controls
    // this checkbox. We deliberately do NOT simulate the click here: jsdom
    // does not implement the interactive-content-descendant exemption (it
    // fires `control.click()` for any non-control label descendant), so a
    // click-based assertion would validate jsdom's bug rather than our markup.
    // The real-browser click behavior is exercised by the e2e suite.
    const label = link.closest('label');
    expect(label).not.toBeNull();
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/termos-de-uso');
    expect(label).toHaveAttribute('for', termsCheckbox.id);
  });

  it('toggles the checkbox when its control is clicked directly (accept)', async () => {
    const user = userEvent.setup();
    render(<SignupForm action={noopAction} />);

    const termsCheckbox = screen.getByTestId('signup-form-terms');
    expect(termsCheckbox).not.toBeChecked();

    await user.click(termsCheckbox);

    expect(termsCheckbox).toBeChecked();
  });
});
