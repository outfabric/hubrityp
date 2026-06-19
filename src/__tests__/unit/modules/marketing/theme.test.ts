import { describe, expect, it } from 'vitest';

import { buildNoFlashThemeScript } from '@/modules/marketing/lib/theme';

/*
 * Theme-resolution core (D4, revised — OS-driven dark-mode substrate).
 *
 * Dark mode follows the OS `prefers-color-scheme` ONLY — there is no user
 * toggle and no persisted (cookie/localStorage) choice. The only shared rule
 * left is the blocking no-flash inline script, which must resolve the theme
 * from `prefers-color-scheme` and never from a stored value.
 */

describe('buildNoFlashThemeScript', () => {
  it('resolves the theme from prefers-color-scheme and sets data-theme', () => {
    const script = buildNoFlashThemeScript();
    expect(script).toContain('prefers-color-scheme: dark');
    expect(script).toContain('data-theme');
  });

  it('reads no stored preference (no cookie / localStorage branch)', () => {
    const script = buildNoFlashThemeScript();
    // The OS preference is the sole source — no persisted choice is consulted.
    expect(script).not.toContain('cookie');
    expect(script).not.toContain('localStorage');
    expect(script).not.toContain('theme=');
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
