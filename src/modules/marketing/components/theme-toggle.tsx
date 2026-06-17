'use client';

// User-facing dark-mode toggle (leaf). Reflects and flips the theme held by
// `ThemeProvider`. Rendered as a native `<button>` (via the Button primitive),
// so Enter/Space activation and the visible focus ring come for free from the
// platform + design-system styles. `aria-pressed` exposes the on/off state to
// assistive tech; the icon is decorative (`aria-hidden`) and the accessible
// name lives on `aria-label`.

import { Moon, Sun } from 'lucide-react';

import { useTheme } from '@/modules/marketing/components/theme-provider';
import { Button } from '@/shared/ui/button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      // `aria-pressed` represents "dark mode is on". The accessible name
      // describes the action the press will perform, in pt-BR (target locale).
      aria-pressed={isDark}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      onClick={toggleTheme}
    >
      {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </Button>
  );
}
