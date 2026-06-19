import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * Logo — Hubrity brand mark as an inline SVG primitive.
 *
 * Justified exception to the project's "always next/image" rule: this mark is
 * rendered as inline SVG (not `next/image`, not an imported `.svg`) for two
 * reasons that `<img>` cannot satisfy:
 *   1. `tone="mono"` / `tone="white"` recolor every fill via `currentColor`,
 *      which only works when the SVG nodes live in the DOM and inherit the
 *      surrounding text color (e.g. a dark header recoloring the lockup white).
 *   2. Zero network request — the geometry ships in the JS bundle, so the
 *      header never flashes an unstyled/blank logo on first paint.
 *
 * Source assets (the exact geometry below is transcribed from them):
 *   - public/brand/simbolo.svg              (color symbol: sálvia/azul/teal)
 *   - public/brand/simbolo-mono.svg         (ink #21261F)
 *   - public/brand/simbolo-branco.svg       (white)
 *   - public/brand/lockup-horizontal.svg    (symbol + "hubrity" wordmark)
 *   - public/brand/lockup-vertical.svg      (symbol stacked above wordmark)
 *
 * The component is purely presentational and MUST stay non-interactive: it
 * renders no `<a>`/`<button>` wrapper. Wrap it at the call site if a link is
 * needed (e.g. a header logo that navigates to the dashboard).
 *
 * Variants: `lockup-h` / `lockup-v` / `symbol` render inline SVG; the
 * `wordmark-text` variant renders the "hubrity" wordmark as live text in
 * Nunito SemiBold via the `--ds-font-wordmark` variable (see the wordmark spec
 * note below). The SVG lockups carry the same Nunito letterforms as traced
 * geometry, so they render identically without depending on the loaded font.
 */

type LogoVariant = 'lockup-h' | 'lockup-v' | 'symbol' | 'wordmark-text';
type LogoTone = 'color' | 'white' | 'mono' | 'inverse';

/*
 * Wordmark spec (docs/design-system/rules.md → Wordmark):
 *   - text: "hubrity" (lowercase)
 *   - font: Nunito SemiBold (600) via `--ds-font-wordmark`
 *   - tracking: ~ -1%
 *   - color: ink `#21261F` (light) / `#FAFAF9` (inverse, dark surfaces)
 *
 * The lockup SVG variants encode the Nunito SemiBold letterforms as traced
 * `<path>` geometry, so they are font-independent (no FOUT, no font request to
 * render). The `wordmark-text` variant below renders live text instead and is
 * the one that actually consumes the Nunito `--ds-font-wordmark` variable —
 * useful where selectable/scalable text is preferable to vector paths.
 */
const WORDMARK_TRACKING = '-0.01em'; // ~ -1%
const WORDMARK_INK = '#21261F';
const WORDMARK_INVERSE = '#FAFAF9';

export interface LogoProps extends React.SVGProps<SVGSVGElement> {
  variant?: LogoVariant;
  tone?: LogoTone;
  className?: string;
}

// Brand palette (manual Sálvia). These literal hex values are the canonical
// brand colors and are only emitted for `tone="color"`; mono/white tones use
// `currentColor` instead. This is the one place literal hex is allowed.
const SALVIA = '#587355';
const AZUL = '#5B7A93';
const TEAL = '#3F6F63';
const INK = '#21261F';

/**
 * Resolve the per-shape fills for the requested tone.
 *
 * - `color` keeps the brand palette (symbol tri-color + ink wordmark).
 * - `inverse` keeps the symbol's brand tri-color but renders the wordmark light
 *   (`#FAFAF9`) so the lockup reads on a dark surface (e.g. the footer) while
 *   the symbol stays canonical (brand `16:7`/`17:2`).
 * - `mono` and `white` collapse every fill to `currentColor`; the visible
 *   color is then driven by the surrounding text color (white tone defaults
 *   to `text-white`, see `toneClassName`).
 */
function resolveFills(tone: LogoTone): {
  hasteA: string;
  hasteB: string;
  elo: string;
  wordmark: string;
} {
  if (tone === 'color') {
    return { hasteA: SALVIA, hasteB: AZUL, elo: TEAL, wordmark: INK };
  }
  if (tone === 'inverse') {
    return { hasteA: SALVIA, hasteB: AZUL, elo: TEAL, wordmark: WORDMARK_INVERSE };
  }
  return {
    hasteA: 'currentColor',
    hasteB: 'currentColor',
    elo: 'currentColor',
    wordmark: 'currentColor',
  };
}

function toneClassName(tone: LogoTone): string | undefined {
  // `white` applies `text-white` by default so `currentColor` resolves to
  // white without the caller having to set a text color. A caller may still
  // override it via `className` (cn keeps the last token).
  return tone === 'white' ? 'text-white' : undefined;
}

/** The "hubrity" wordmark — 7 paths, transcribed from lockup-horizontal.svg. */
function Wordmark({ fill }: { fill: string }): React.JSX.Element {
  return (
    <g>
      <path
        d="M117.6 69.56C116.32 69.56 115.333 69.2133 114.64 68.52C113.947 67.7733 113.6 66.76 113.6 65.48V16.12C113.6 14.7867 113.947 13.7733 114.64 13.08C115.333 12.3867 116.32 12.04 117.6 12.04C118.88 12.04 119.867 12.3867 120.56 13.08C121.307 13.7733 121.68 14.7867 121.68 16.12V38.28H120.56C121.733 35.2933 123.573 33.0533 126.08 31.56C128.587 30.0133 131.467 29.24 134.72 29.24C137.813 29.24 140.373 29.8267 142.4 31C144.48 32.12 146.027 33.8533 147.04 36.2C148.053 38.4933 148.56 41.4 148.56 44.92V65.48C148.56 66.76 148.213 67.7733 147.52 68.52C146.827 69.2133 145.84 69.56 144.56 69.56C143.227 69.56 142.213 69.2133 141.52 68.52C140.827 67.7733 140.48 66.76 140.48 65.48V45.4C140.48 42.04 139.813 39.5867 138.48 38.04C137.2 36.4933 135.173 35.72 132.4 35.72C129.147 35.72 126.533 36.7333 124.56 38.76C122.64 40.7867 121.68 43.5067 121.68 46.92V65.48C121.68 68.2 120.32 69.56 117.6 69.56Z"
        fill={fill}
      />
      <path
        d="M172.814 69.72C169.667 69.72 167.027 69.1333 164.894 67.96C162.814 66.7867 161.24 65.0533 160.174 62.76C159.16 60.4133 158.654 57.48 158.654 53.96V33.48C158.654 32.0933 159 31.08 159.694 30.44C160.387 29.7467 161.374 29.4 162.654 29.4C163.934 29.4 164.92 29.7467 165.614 30.44C166.36 31.08 166.734 32.0933 166.734 33.48V54.04C166.734 57.1867 167.374 59.5067 168.654 61C169.934 62.4933 171.96 63.24 174.734 63.24C177.774 63.24 180.227 62.2267 182.094 60.2C184.014 58.12 184.974 55.4 184.974 52.04V33.48C184.974 32.0933 185.32 31.08 186.014 30.44C186.707 29.7467 187.72 29.4 189.054 29.4C190.334 29.4 191.32 29.7467 192.014 30.44C192.707 31.08 193.054 32.0933 193.054 33.48V65.48C193.054 68.2 191.747 69.56 189.134 69.56C187.907 69.56 186.947 69.2133 186.254 68.52C185.56 67.7733 185.214 66.76 185.214 65.48V58.68L186.254 60.44C185.187 63.4267 183.48 65.72 181.134 67.32C178.787 68.92 176.014 69.72 172.814 69.72Z"
        fill={fill}
      />
      <path
        d="M224.601 69.72C221.187 69.72 218.227 68.8667 215.721 67.16C213.214 65.4 211.534 63.08 210.681 60.2L211.561 58.76V65.48C211.561 66.76 211.214 67.7733 210.521 68.52C209.827 69.2133 208.867 69.56 207.641 69.56C206.361 69.56 205.374 69.2133 204.681 68.52C203.987 67.7733 203.641 66.76 203.641 65.48V16.12C203.641 14.7867 203.987 13.7733 204.681 13.08C205.374 12.3867 206.361 12.04 207.641 12.04C208.921 12.04 209.907 12.3867 210.601 13.08C211.347 13.7733 211.721 14.7867 211.721 16.12V38.52H210.761C211.614 35.6933 213.294 33.4533 215.801 31.8C218.307 30.0933 221.241 29.24 224.601 29.24C228.121 29.24 231.161 30.0667 233.721 31.72C236.281 33.3733 238.254 35.6933 239.641 38.68C241.081 41.6667 241.801 45.2667 241.801 49.48C241.801 53.5867 241.081 57.1867 239.641 60.28C238.254 63.32 236.254 65.6667 233.641 67.32C231.081 68.92 228.067 69.72 224.601 69.72ZM222.601 63.48C224.841 63.48 226.787 62.9467 228.441 61.88C230.094 60.8133 231.374 59.24 232.281 57.16C233.187 55.08 233.641 52.52 233.641 49.48C233.641 44.8933 232.627 41.4267 230.601 39.08C228.627 36.7333 225.961 35.56 222.601 35.56C220.414 35.56 218.467 36.0933 216.761 37.16C215.107 38.1733 213.827 39.72 212.921 41.8C212.014 43.88 211.561 46.44 211.561 49.48C211.561 54.0133 212.574 57.48 214.601 59.88C216.627 62.28 219.294 63.48 222.601 63.48Z"
        fill={fill}
      />
      <path
        d="M254.186 69.56C252.853 69.56 251.84 69.2133 251.146 68.52C250.453 67.7733 250.106 66.76 250.106 65.48V33.48C250.106 32.1467 250.453 31.1333 251.146 30.44C251.84 29.7467 252.8 29.4 254.026 29.4C255.306 29.4 256.266 29.7467 256.906 30.44C257.6 31.1333 257.946 32.1467 257.946 33.48V39.32H257.146C258 36.12 259.573 33.6933 261.866 32.04C264.16 30.3867 267.093 29.4267 270.666 29.16C271.626 29.1067 272.373 29.3467 272.906 29.88C273.493 30.4133 273.813 31.24 273.866 32.36C273.973 33.48 273.733 34.3867 273.146 35.08C272.56 35.72 271.653 36.0933 270.426 36.2L268.906 36.36C265.44 36.68 262.8 37.7733 260.986 39.64C259.173 41.5067 258.266 44.0667 258.266 47.32V65.48C258.266 66.76 257.92 67.7733 257.226 68.52C256.586 69.2133 255.573 69.56 254.186 69.56Z"
        fill={fill}
      />
      <path
        d="M283.15 69.48C281.87 69.48 280.883 69.1067 280.19 68.36C279.497 67.56 279.15 66.4667 279.15 65.08V33.88C279.15 32.4933 279.497 31.4267 280.19 30.68C280.883 29.9333 281.87 29.56 283.15 29.56C284.43 29.56 285.417 29.9333 286.11 30.68C286.857 31.4267 287.23 32.4933 287.23 33.88V65.08C287.23 66.4667 286.883 67.56 286.19 68.36C285.497 69.1067 284.483 69.48 283.15 69.48ZM283.15 21.24C281.55 21.24 280.297 20.84 279.39 20.04C278.537 19.24 278.11 18.12 278.11 16.68C278.11 15.1867 278.537 14.0667 279.39 13.32C280.297 12.52 281.55 12.12 283.15 12.12C284.75 12.12 285.977 12.52 286.83 13.32C287.737 14.0667 288.19 15.1867 288.19 16.68C288.19 18.12 287.737 19.24 286.83 20.04C285.977 20.84 284.75 21.24 283.15 21.24Z"
        fill={fill}
      />
      <path
        d="M314.443 69.72C311.243 69.72 308.55 69.16 306.363 68.04C304.176 66.92 302.55 65.2667 301.483 63.08C300.416 60.8933 299.883 58.2267 299.883 55.08V36.2H295.083C294.016 36.2 293.19 35.9333 292.603 35.4C292.016 34.8133 291.723 34.04 291.723 33.08C291.723 32.0667 292.016 31.2933 292.603 30.76C293.19 30.2267 294.016 29.96 295.083 29.96H299.883V21.72C299.883 20.3867 300.23 19.3733 300.923 18.68C301.67 17.9867 302.683 17.64 303.963 17.64C305.243 17.64 306.23 17.9867 306.923 18.68C307.616 19.3733 307.963 20.3867 307.963 21.72V29.96H317.323C318.39 29.96 319.216 30.2267 319.803 30.76C320.39 31.2933 320.683 32.0667 320.683 33.08C320.683 34.04 320.39 34.8133 319.803 35.4C319.216 35.9333 318.39 36.2 317.323 36.2H307.963V54.44C307.963 57.2667 308.55 59.4 309.723 60.84C310.95 62.28 312.923 63 315.643 63C316.603 63 317.43 62.92 318.123 62.76C318.87 62.5467 319.483 62.4133 319.963 62.36C320.55 62.36 321.03 62.5733 321.403 63C321.776 63.3733 321.963 64.12 321.963 65.24C321.963 66.04 321.803 66.7867 321.483 67.48C321.216 68.1733 320.71 68.6267 319.963 68.84C319.323 69.0533 318.443 69.24 317.323 69.4C316.256 69.6133 315.296 69.72 314.443 69.72Z"
        fill={fill}
      />
      <path
        d="M335.969 83.96C335.009 83.96 334.209 83.6933 333.569 83.16C332.982 82.68 332.635 82.0133 332.529 81.16C332.475 80.36 332.635 79.48 333.009 78.52L338.449 66.28V69.72L323.489 34.92C323.115 33.96 322.982 33.0533 323.089 32.2C323.195 31.3467 323.595 30.68 324.289 30.2C324.982 29.6667 325.915 29.4 327.089 29.4C328.102 29.4 328.902 29.64 329.489 30.12C330.075 30.6 330.609 31.4267 331.089 32.6L343.169 62.44H340.929L353.169 32.6C353.649 31.3733 354.209 30.5467 354.849 30.12C355.489 29.64 356.369 29.4 357.489 29.4C358.449 29.4 359.195 29.6667 359.729 30.2C360.315 30.68 360.662 31.3467 360.769 32.2C360.929 33 360.795 33.88 360.369 34.84L340.369 80.84C339.835 82.0667 339.222 82.8933 338.529 83.32C337.889 83.7467 337.035 83.96 335.969 83.96Z"
        fill={fill}
      />
    </g>
  );
}

/** The "H" symbol — 3 rounded rects. Coordinates suit the horizontal lockup. */
function Symbol({
  hasteA,
  hasteB,
  elo,
}: {
  hasteA: string;
  hasteB: string;
  elo: string;
}): React.JSX.Element {
  return (
    <g>
      <rect width="26.4" height="96" rx="13.2" fill={hasteA} />
      <rect x="61.2" width="26.4" height="96" rx="13.2" fill={hasteB} />
      <rect x="18" y="33.6" width="51.6" height="24" rx="12" fill={elo} />
    </g>
  );
}

/**
 * Logo renders the Hubrity mark inline. See the file header for the rationale
 * behind inline SVG and the source asset mapping.
 */
export function Logo({
  variant = 'lockup-h',
  tone = 'color',
  className,
  ...svgProps
}: LogoProps): React.JSX.Element {
  const fills = resolveFills(tone);
  const accessibleProps = {
    role: 'img' as const,
    'aria-label': 'Hubrity',
  };

  if (variant === 'wordmark-text') {
    // Live-text wordmark — the only variant that consumes the Nunito
    // `--ds-font-wordmark` variable (the lockups use traced SVG paths). Renders
    // a non-interactive <span>; SVG-specific props are intentionally not
    // forwarded here (this is not an <svg>). `color` is set explicitly so the
    // wordmark reads ink on light surfaces (`color`/`mono`) and light on
    // dark/white surfaces (`white`/`inverse`), matching the brand spec.
    const color = tone === 'color' || tone === 'mono' ? WORDMARK_INK : WORDMARK_INVERSE;
    return (
      <span
        {...accessibleProps}
        className={cn('font-wordmark font-semibold lowercase', className)}
        style={{
          fontFamily: 'var(--ds-font-wordmark)',
          letterSpacing: WORDMARK_TRACKING,
          color,
        }}
      >
        hubrity
      </span>
    );
  }

  if (variant === 'symbol') {
    // Symbol-only — square viewBox matching public/brand/simbolo.svg.
    return (
      <svg
        viewBox="0 0 146 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(toneClassName(tone), className)}
        {...accessibleProps}
        {...svgProps}
      >
        <title>Hubrity</title>
        <rect width="44" height="160" rx="22" fill={fills.hasteA} />
        <rect x="102" width="44" height="160" rx="22" fill={fills.hasteB} />
        <rect x="30" y="56" width="86" height="40" rx="20" fill={fills.elo} />
      </svg>
    );
  }

  if (variant === 'lockup-v') {
    // Vertical lockup — symbol stacked above the wordmark. The symbol keeps the
    // horizontal-lockup coordinate system and is centered above a wordmark that
    // is translated down; the viewBox tightly wraps both groups.
    return (
      <svg
        viewBox="0 0 247 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(toneClassName(tone), className)}
        {...accessibleProps}
        {...svgProps}
      >
        <title>Hubrity</title>
        <g transform="translate(79.7 0)">
          <Symbol hasteA={fills.hasteA} hasteB={fills.hasteB} elo={fills.elo} />
        </g>
        <g transform="translate(-113.6 116)">
          <Wordmark fill={fills.wordmark} />
        </g>
      </svg>
    );
  }

  // lockup-h (default) — symbol + wordmark side by side, matching
  // public/brand/lockup-horizontal.svg.
  return (
    <svg
      viewBox="0 0 361 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(toneClassName(tone), className)}
      {...accessibleProps}
      {...svgProps}
    >
      <title>Hubrity</title>
      <Symbol hasteA={fills.hasteA} hasteB={fills.hasteB} elo={fills.elo} />
      <Wordmark fill={fills.wordmark} />
    </svg>
  );
}

Logo.displayName = 'Logo';
