import { describe, expect, it } from 'vitest';

import {
  THEME_COOKIE_MAX_AGE,
  THEME_COOKIE_NAME,
  buildNoFlashThemeScript,
  parseStoredTheme,
  resolveTheme,
  serializeThemeCookie,
} from '@/modules/marketing/lib/theme';

/*
 * Theme-resolution core (D4 — hand-rolled dark-mode substrate).
 *
 * These are the pure rules shared by the server layout, the blocking no-flash
 * inline script, and the client provider. Locking them down here guarantees all
 * three agree on the same precedence: explicit stored choice > OS > light.
 */

describe('parseStoredTheme', () => {
  it('accepts the two valid theme values', () => {
    expect(parseStoredTheme('light')).toBe('light');
    expect(parseStoredTheme('dark')).toBe('dark');
  });

  it('rejects absent or unrecognized values (anti-tampering gate)', () => {
    expect(parseStoredTheme(null)).toBeNull();
    expect(parseStoredTheme(undefined)).toBeNull();
    expect(parseStoredTheme('')).toBeNull();
    expect(parseStoredTheme('DARK')).toBeNull();
    expect(parseStoredTheme('evil')).toBeNull();
  });
});

describe('resolveTheme — precedence: stored > OS > light', () => {
  it('uses the explicit stored choice over the OS preference', () => {
    // Stored light wins even when the OS prefers dark.
    expect(resolveTheme('light', true)).toBe('light');
    // Stored dark wins even when the OS prefers light.
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS preference when there is no stored choice', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('defaults to light when no stored choice and OS does not prefer dark', () => {
    expect(resolveTheme(undefined, false)).toBe('light');
  });

  it('ignores a tampered cookie value and falls back to OS/light', () => {
    expect(resolveTheme('evil', true)).toBe('dark');
    expect(resolveTheme('evil', false)).toBe('light');
  });
});

describe('serializeThemeCookie', () => {
  it('uses the agreed name, 1-year max-age, root path and SameSite=Lax', () => {
    const cookie = serializeThemeCookie('dark');
    expect(cookie).toContain(`${THEME_COOKIE_NAME}=dark`);
    expect(cookie).toContain(`Max-Age=${THEME_COOKIE_MAX_AGE}`);
    expect(THEME_COOKIE_MAX_AGE).toBe(31_536_000);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('does not set the Secure flag (so it works over http in local dev)', () => {
    expect(serializeThemeCookie('light')).not.toMatch(/;\s*Secure/i);
  });

  it('serializes both theme values', () => {
    expect(serializeThemeCookie('light')).toContain(`${THEME_COOKIE_NAME}=light`);
    expect(serializeThemeCookie('dark')).toContain(`${THEME_COOKIE_NAME}=dark`);
  });
});

describe('buildNoFlashThemeScript', () => {
  it('reads the theme cookie, falls back to prefers-color-scheme, and sets data-theme', () => {
    const script = buildNoFlashThemeScript();
    expect(script).toContain('theme=');
    expect(script).toContain('prefers-color-scheme: dark');
    expect(script).toContain('data-theme');
  });

  it('is wrapped in a try/catch so a failure degrades to light', () => {
    const script = buildNoFlashThemeScript();
    expect(script).toContain('try');
    expect(script).toContain('catch');
    expect(script).toContain("'light'");
  });

  it('contains no interpolated data (safe to inject via dangerouslySetInnerHTML)', () => {
    // The generated string is identical on every call — a fixed literal with no
    // user input woven in, so it cannot become an injection sink.
    expect(buildNoFlashThemeScript()).toBe(buildNoFlashThemeScript());
  });
});
