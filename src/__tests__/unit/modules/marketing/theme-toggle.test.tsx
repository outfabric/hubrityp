import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '@/modules/marketing/components/theme-provider';
import { ThemeToggle } from '@/modules/marketing/components/theme-toggle';

/*
 * ThemeToggle (leaf) — DOM behavior.
 *
 * Verifies the accessibility contract from the spec ("keyboard-accessible:
 * Enter/Space, aria-pressed") and that pressing it flips `data-theme` on
 * `<html>` and persists the `theme` cookie. The provider adopts the value the
 * no-flash script applied to `<html>`; here we simulate that by setting the
 * attribute before rendering.
 */

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  // Clear the theme cookie between tests so persistence assertions are isolated.
  document.cookie = 'theme=; Path=/; Max-Age=0';
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle', () => {
  it('exposes aria-pressed=false and a "switch to dark" label in light mode', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    renderToggle();

    const button = await screen.findByRole('button', { name: 'Ativar tema escuro' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('exposes aria-pressed=true and a "switch to light" label in dark mode', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderToggle();

    const button = await screen.findByRole('button', { name: 'Ativar tema claro' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('flips data-theme and persists the cookie when clicked', async () => {
    const user = userEvent.setup();
    document.documentElement.setAttribute('data-theme', 'light');
    renderToggle();

    const button = await screen.findByRole('button', { name: 'Ativar tema escuro' });
    await user.click(button);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.cookie).toContain('theme=dark');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('is operable with the keyboard via Enter', async () => {
    const user = userEvent.setup();
    document.documentElement.setAttribute('data-theme', 'light');
    renderToggle();

    const button = await screen.findByRole('button', { name: 'Ativar tema escuro' });
    button.focus();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('is operable with the keyboard via Space', async () => {
    const user = userEvent.setup();
    document.documentElement.setAttribute('data-theme', 'light');
    renderToggle();

    const button = await screen.findByRole('button', { name: 'Ativar tema escuro' });
    button.focus();

    await user.keyboard('{ }');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
