import * as React from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * GoogleIcon — the official multi-color Google "G" as an inline SVG primitive.
 *
 * Mirrors the {@link Logo} primitive's shape (`React.SVGProps<SVGSVGElement>`,
 * `viewBox`, `className` merged via `cn`, zero network request) but with two
 * deliberate differences driven by Google's brand guidelines:
 *
 *   1. The four brand colors are FIXED literal hex values and are never
 *      collapsed to `currentColor` — Google requires the "G" to keep its
 *      colors, so this primitive accepts no `tone` prop.
 *   2. The glyph is decorative: it sits next to the button's visible text
 *      label ("Entrar com Google" / "Cadastrar com Google"), so it carries
 *      `aria-hidden="true"` instead of `role="img"`/`aria-label`. It MUST stay
 *      visible (never `display:none`) so the brand mark actually renders.
 *
 * Why inline SVG over `next/image`/an imported asset: consistency with the
 * established `Logo` pattern and no first-paint flash. Why not lucide: lucide
 * ships no Google brand glyph. This is one of the few places literal brand hex
 * is allowed (see `Logo` for the analogous exception).
 */

// Official Google "G" palette. These literal hex values are the canonical
// brand colors and must not be recolored.
const GOOGLE_BLUE = '#4285F4';
const GOOGLE_GREEN = '#34A853';
const GOOGLE_YELLOW = '#FBBC05';
const GOOGLE_RED = '#EA4335';

export type GoogleIconProps = React.SVGProps<SVGSVGElement>;

/**
 * GoogleIcon renders the official 4-color Google "G" inline. Purely
 * presentational and non-interactive — wrap it at the call site if needed.
 */
export function GoogleIcon({ className, ...svgProps }: GoogleIconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(className)}
      {...svgProps}
    >
      <path
        fill={GOOGLE_BLUE}
        d="M47.532 24.552c0-1.636-.146-3.21-.418-4.72H24.48v8.93h12.93c-.557 3.003-2.25 5.546-4.794 7.25v6.022h7.756c4.538-4.18 7.16-10.336 7.16-17.482z"
      />
      <path
        fill={GOOGLE_GREEN}
        d="M24.48 48c6.48 0 11.916-2.148 15.888-5.816l-7.756-6.022c-2.148 1.44-4.896 2.292-8.132 2.292-6.252 0-11.546-4.224-13.436-9.9H3.024v6.218C6.974 42.62 14.114 48 24.48 48z"
      />
      <path
        fill={GOOGLE_YELLOW}
        d="M11.044 28.554c-.48-1.44-.756-2.978-.756-4.554s.276-3.114.756-4.554v-6.218H3.024A23.96 23.96 0 0 0 .48 24c0 3.872.928 7.538 2.544 10.772l8.02-6.218z"
      />
      <path
        fill={GOOGLE_RED}
        d="M24.48 9.546c3.528 0 6.696 1.212 9.186 3.594l6.888-6.888C36.39 2.39 30.954 0 24.48 0 14.114 0 6.974 5.38 3.024 13.228l8.02 6.218c1.89-5.676 7.184-9.9 13.436-9.9z"
      />
    </svg>
  );
}

GoogleIcon.displayName = 'GoogleIcon';
