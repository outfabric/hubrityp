// Dark-mode substrate for the public marketing site.
// --------------------------------------------------------------------------
// Design decision (D4, revised): a minimal, OS-driven dark-mode layer with NO
// user-facing toggle and NO persisted choice. The active theme follows the OS
// `prefers-color-scheme` only — there is no `theme` cookie and no localStorage.
//
// The active theme is expressed as the `data-theme` attribute on `<html>`.
// Setting `data-theme='dark'` flips the entire token set (declared in
// `globals.css`) within one frame, with no class churn and no React re-render.
//
// Resolution order:
//   1. OS preference  (`prefers-color-scheme: dark`)
//   2. Light          (default)
//
// This module is pure and client-safe: no Node-only deps, no `server-only`
// guard. It is imported by the blocking no-flash inline script (as the
// generated string). Keeping the logic here makes it unit-testable in isolation.

/** The two themes the UI can resolve to. The `data-theme` attribute value. */
export type Theme = 'light' | 'dark';

/**
 * Builds the blocking inline script injected into `<head>`. It runs before
 * first paint and applies `data-theme` to `<html>` so there is no
 * flash-of-unstyled-content (FOUC) when the OS prefers dark while the CSS
 * default is light.
 *
 * The script resolves the theme from `matchMedia('(prefers-color-scheme: dark)')`
 * only — there is no stored-preference branch — and sets
 * `document.documentElement.dataset.theme`.
 *
 * It contains no interpolated/user data — it is a fixed string — so it is safe
 * to inject via `dangerouslySetInnerHTML` (the only way to make it blocking).
 * Wrapped in a `try/catch` so a hostile environment degrades to the light
 * default rather than throwing before paint.
 */
export function buildNoFlashThemeScript(): string {
  return `(function(){try{var t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
}
