'use client';

// Hand-rolled theme context (D4 — no `next-themes`). Holds the resolved theme,
// keeps `<html data-theme>` in sync, and persists explicit choices to the
// `theme` cookie. The blocking no-flash script in `<head>` already applied the
// correct `data-theme` before paint; this provider only takes over once React
// hydrates, reading the value the script set so the two never disagree.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { parseStoredTheme, serializeThemeCookie, type Theme } from '@/modules/marketing/lib/theme';

interface ThemeContextValue {
  /** The currently applied theme. */
  readonly theme: Theme;
  /** Sets an explicit theme, applying it to `<html>` and persisting the cookie. */
  readonly setTheme: (theme: Theme) => void;
  /** Flips between light and dark. */
  readonly toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Reads the theme that the no-flash inline script already applied to `<html>`.
 * On the server (and before hydration) `document` is undefined, so we fall back
 * to the SSR default the layout rendered with (`light`) — the post-hydration
 * effect reconciles to the real DOM value, which the script set correctly.
 */
function readAppliedTheme(): Theme {
  if (typeof document === 'undefined') {
    return 'light';
  }
  return parseStoredTheme(document.documentElement.getAttribute('data-theme')) ?? 'light';
}

/**
 * Provides theme state to the public site. Wrap the marketing layout subtree.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: on the client this reads the `data-theme` the blocking
  // no-flash script already applied to `<html>`, so the provider and the DOM
  // agree from the first render. On the server `document` is undefined and we
  // fall back to the SSR default (`light`); the layout independently mirrors
  // the cookie onto `<html>`, so the stored-choice path stays flash-free.
  const [theme, setThemeState] = useState<Theme>(readAppliedTheme);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute('data-theme', next);
    document.cookie = serializeThemeCookie(next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readAppliedTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Reads the theme context. Throws when used outside a {@link ThemeProvider} so
 * the misuse surfaces at development time rather than as a silent no-op.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
