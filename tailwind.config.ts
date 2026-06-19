import type { Config } from 'tailwindcss';

/**
 * Tailwind config — companion to the canonical `@theme inline` block in
 * `src/app/globals.css`.
 *
 * Tailwind v4 reads design tokens from CSS (`@theme`) at build time, so the
 * `theme.extend.*` mappings below are effectively documentation: they spell
 * out, in JS, the contract that the CSS layer enforces — every color, radius,
 * shadow, duration, and font-family is sourced from a `var(--token)`. The
 * spec for `auth-account-creation` requires this file to exist and to map
 * tokens to CSS custom properties; it is intentionally redundant with
 * `globals.css` so contributors editing JS-side tooling (Tailwind plugins,
 * intellisense, prettier-plugin-tailwindcss class sorting) see the same
 * contract.
 *
 * `darkMode: ['class', "[data-theme='dark']"]` declares the JS-side strategy
 * for IDE support and any v3-style plugins that still read the option. The
 * runtime dark variant is wired in `globals.css` via `@custom-variant dark
 * (&:where([data-theme='dark'], [data-theme='dark'] *))`.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', "[data-theme='dark']"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--ds-font-sans)'],
        mono: ['var(--ds-font-mono)'],
        // Brand wordmark only — Nunito. Body/UI text stays on `sans` (Inter).
        wordmark: ['var(--ds-font-wordmark)'],
      },
      /*
       * Marketing display scale (public site). Tuple syntax mirrors the
       * `--text-*` modifiers declared in `globals.css`: each utility bundles
       * font-size + line-height + letter-spacing + font-weight. Inter only,
       * weight 400/600 — never >=700 (DS weight rule).
       */
      fontSize: {
        'display-xl': [
          'var(--ds-text-display-xl)',
          {
            lineHeight: 'var(--ds-text-display-xl-line-height)',
            letterSpacing: 'var(--ds-text-display-xl-letter-spacing)',
            fontWeight: 'var(--ds-text-display-xl-font-weight)',
          },
        ],
        'display-lg': [
          'var(--ds-text-display-lg)',
          {
            lineHeight: 'var(--ds-text-display-lg-line-height)',
            letterSpacing: 'var(--ds-text-display-lg-letter-spacing)',
            fontWeight: 'var(--ds-text-display-lg-font-weight)',
          },
        ],
        'display-md': [
          'var(--ds-text-display-md)',
          {
            lineHeight: 'var(--ds-text-display-md-line-height)',
            letterSpacing: 'var(--ds-text-display-md-letter-spacing)',
            fontWeight: 'var(--ds-text-display-md-font-weight)',
          },
        ],
        lead: [
          'var(--ds-text-lead)',
          {
            lineHeight: 'var(--ds-text-lead-line-height)',
            letterSpacing: 'var(--ds-text-lead-letter-spacing)',
            fontWeight: 'var(--ds-text-lead-font-weight)',
          },
        ],
      },
      colors: {
        background: 'var(--ds-background)',
        surface: {
          DEFAULT: 'var(--ds-surface)',
          muted: 'var(--ds-surface-muted)',
          sunken: 'var(--ds-surface-sunken)',
        },
        border: {
          DEFAULT: 'var(--ds-border)',
          strong: 'var(--ds-border-strong)',
          subtle: 'var(--ds-border-subtle)',
        },
        text: {
          primary: 'var(--ds-text-primary)',
          secondary: 'var(--ds-text-secondary)',
          tertiary: 'var(--ds-text-tertiary)',
          disabled: 'var(--ds-text-disabled)',
          inverse: 'var(--ds-text-inverse)',
        },
        brand: {
          50: 'var(--ds-brand-50)',
          100: 'var(--ds-brand-100)',
          200: 'var(--ds-brand-200)',
          300: 'var(--ds-brand-300)',
          400: 'var(--ds-brand-400)',
          500: 'var(--ds-brand-500)',
          600: 'var(--ds-brand-600)',
          700: 'var(--ds-brand-700)',
          800: 'var(--ds-brand-800)',
          900: 'var(--ds-brand-900)',
        },
        success: {
          50: 'var(--ds-success-50)',
          500: 'var(--ds-success-500)',
          700: 'var(--ds-success-700)',
        },
        warning: {
          50: 'var(--ds-warning-50)',
          500: 'var(--ds-warning-500)',
          700: 'var(--ds-warning-700)',
        },
        danger: {
          50: 'var(--ds-danger-50)',
          500: 'var(--ds-danger-500)',
          700: 'var(--ds-danger-700)',
        },
        info: {
          50: 'var(--ds-info-50)',
          500: 'var(--ds-info-500)',
          700: 'var(--ds-info-700)',
        },
      },
      borderRadius: {
        sm: 'var(--ds-radius-sm)',
        md: 'var(--ds-radius-md)',
        lg: 'var(--ds-radius-lg)',
        xl: 'var(--ds-radius-xl)',
        '2xl': 'var(--ds-radius-2xl)',
        full: 'var(--ds-radius-full)',
      },
      boxShadow: {
        xs: 'var(--ds-shadow-xs)',
        sm: 'var(--ds-shadow-sm)',
        md: 'var(--ds-shadow-md)',
        lg: 'var(--ds-shadow-lg)',
        focus: 'var(--ds-shadow-focus)',
      },
      transitionDuration: {
        fast: 'var(--ds-duration-fast)',
        base: 'var(--ds-duration-base)',
        slow: 'var(--ds-duration-slow)',
      },
      transitionTimingFunction: {
        out: 'var(--ds-ease-out)',
      },
    },
  },
};

export default config;
