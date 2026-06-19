import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Marketing typography + Nunito wordmark (token layer).
 *
 * The marketing type scale is defined as design tokens, not as a TS module:
 * the runtime tokens (`--ds-text-*`) live in `globals.css` and the Tailwind
 * theme exposes them as `text-display-xl|lg|md` / `text-lead` utilities (CSS
 * `@theme inline` plus the JS-side contract in `tailwind.config.ts`). These
 * tests assert the tokens resolve to the spec values, that the DS weight rule
 * (400/600 only, never >=700) holds, and that the brand wordmark font variable
 * (`--ds-font-wordmark`) is backed by Nunito with Inter only as a fallback.
 *
 * The DOM-level proof that the `Logo` `wordmark-text` variant actually renders
 * with the `--ds-font-wordmark` variable lives in `logo.test.tsx` (jsdom);
 * this file is node-env (`.test.ts`) and only parses the token sources.
 */

const globalsCss = readFileSync(
  fileURLToPath(new URL('../../../../app/globals.css', import.meta.url)),
  'utf8',
);
const tailwindConfig = readFileSync(
  fileURLToPath(new URL('../../../../../tailwind.config.ts', import.meta.url)),
  'utf8',
);

/** Reads a `--ds-*: <value>;` declaration from globals.css. */
function dsToken(name: string): string {
  const match = globalsCss.match(new RegExp(`${name}:\\s*([^;]+);`));
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`token ${name} not found in globals.css`);
  }
  return value.trim();
}

interface MarketingTokenSpec {
  readonly utility: string;
  readonly base: string;
  readonly size: string;
  readonly lineHeight: string;
  readonly letterSpacing: string;
  readonly fontWeight: string;
}

const MARKETING_TOKENS: readonly MarketingTokenSpec[] = [
  {
    utility: 'text-display-xl',
    base: '--ds-text-display-xl',
    size: '3.25rem', // 52px
    lineHeight: '3.5rem', // 56px
    letterSpacing: '-0.005em', // -0.5%
    fontWeight: '600',
  },
  {
    utility: 'text-display-lg',
    base: '--ds-text-display-lg',
    size: '2.5rem', // 40px
    lineHeight: '2.875rem', // 46px
    letterSpacing: '-0.004em', // -0.4%
    fontWeight: '600',
  },
  {
    utility: 'text-display-md',
    base: '--ds-text-display-md',
    size: '2rem', // 32px
    lineHeight: '2.5rem', // 40px
    letterSpacing: '-0.002em', // -0.2%
    fontWeight: '600',
  },
  {
    utility: 'text-lead',
    base: '--ds-text-lead',
    size: '1.25rem', // 20px
    lineHeight: '1.875rem', // 30px
    letterSpacing: '0',
    fontWeight: '400',
  },
];

describe('marketing type scale tokens', () => {
  it.each(MARKETING_TOKENS)('$utility resolves to the spec size/line-height/tracking', (token) => {
    expect(dsToken(token.base)).toBe(token.size);
    expect(dsToken(`${token.base}-line-height`)).toBe(token.lineHeight);
    expect(dsToken(`${token.base}-letter-spacing`)).toBe(token.letterSpacing);
  });

  it.each(MARKETING_TOKENS)('$utility uses weight 400 or 600 (never >=700)', (token) => {
    const weight = Number(dsToken(`${token.base}-font-weight`));
    expect([400, 600]).toContain(weight);
    expect(weight).toBeLessThan(700);
  });

  it('exposes each marketing token as a token-backed Tailwind utility', () => {
    for (const token of MARKETING_TOKENS) {
      // `@theme inline` wires the `--text-*` namespace to the runtime token via var().
      expect(globalsCss).toContain(
        `--text-${token.utility.replace('text-', '')}: var(${token.base})`,
      );
      // The JS-side contract references the same runtime token, not a literal.
      expect(tailwindConfig).toContain(`var(${token.base})`);
    }
  });

  it('never declares a marketing font-weight >= 700', () => {
    for (const token of MARKETING_TOKENS) {
      expect(Number(dsToken(`${token.base}-font-weight`))).toBeLessThan(700);
    }
  });
});

describe('Nunito wordmark', () => {
  it('defines --ds-font-wordmark backed by Nunito with an Inter-family fallback', () => {
    const value = dsToken('--ds-font-wordmark');
    expect(value).toContain('Nunito');
    // Body/UI font (Inter) must remain the fallback, never the primary face.
    expect(value).toContain('var(--ds-font-sans)');
  });

  it('exposes the wordmark font as the `font-wordmark` Tailwind utility', () => {
    expect(globalsCss).toContain('--font-wordmark: var(--ds-font-wordmark)');
    expect(tailwindConfig).toContain("wordmark: ['var(--ds-font-wordmark)']");
  });
});
